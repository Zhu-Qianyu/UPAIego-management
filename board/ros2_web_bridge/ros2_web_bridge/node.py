from __future__ import annotations

from datetime import datetime, timezone
import os
import shlex
import subprocess
import time
from typing import Any, Dict, Optional

import requests
import rclpy
from rclpy.node import Node
from std_msgs.msg import Float32, String


class WebBridgeNode(Node):
    """Bridge ROS2 runtime state with website device API."""

    def __init__(self) -> None:
        super().__init__("web_bridge_node")

        self.declare_parameter("mode", "supabase")
        self.declare_parameter("base_url", "http://127.0.0.1:8000")
        self.declare_parameter("supabase_url", "")
        self.declare_parameter("supabase_key", "")
        self.declare_parameter("supabase_table", "devices")
        self.declare_parameter("device_id", "")
        self.declare_parameter("poll_interval_sec", 10.0)
        self.declare_parameter("request_timeout_sec", 5.0)
        self.declare_parameter("firmware_version", "")
        self.declare_parameter("status", "active")
        self.declare_parameter("record_on_startup", True)
        self.declare_parameter("recording_device", "/dev/video0")
        self.declare_parameter("recording_dir", "/home/cat/videos")
        self.declare_parameter("recording_resolution", "2560x720")
        self.declare_parameter("recording_fps", 60)
        self.declare_parameter("recording_bitrate", "5000k")
        self.declare_parameter("ffmpeg_codec", "h264_rkmpp")

        self.mode = str(self.get_parameter("mode").value).lower().strip()
        self.base_url = self.get_parameter("base_url").value.rstrip("/")
        self.supabase_url = self.get_parameter("supabase_url").value.rstrip("/")
        self.supabase_key = self.get_parameter("supabase_key").value.strip()
        self.supabase_table = self.get_parameter("supabase_table").value
        self.device_id = self.get_parameter("device_id").value
        self.poll_interval_sec = float(self.get_parameter("poll_interval_sec").value)
        self.request_timeout_sec = float(self.get_parameter("request_timeout_sec").value)
        self.firmware_version = self.get_parameter("firmware_version").value
        self.status = self.get_parameter("status").value
        self.record_on_startup = bool(self.get_parameter("record_on_startup").value)
        self.recording_device = str(self.get_parameter("recording_device").value)
        self.recording_dir = str(self.get_parameter("recording_dir").value)
        self.recording_resolution = str(self.get_parameter("recording_resolution").value)
        self.recording_fps = int(self.get_parameter("recording_fps").value)
        self.recording_bitrate = str(self.get_parameter("recording_bitrate").value)
        self.ffmpeg_codec = str(self.get_parameter("ffmpeg_codec").value)

        if not self.device_id:
            raise ValueError("ROS parameter 'device_id' is required.")
        if self.mode not in {"backend", "supabase"}:
            raise ValueError("ROS parameter 'mode' must be 'backend' or 'supabase'.")
        if self.mode == "supabase" and (not self.supabase_url or not self.supabase_key):
            raise ValueError(
                "supabase mode requires both 'supabase_url' and 'supabase_key'."
            )

        self.session = requests.Session()
        if self.mode == "supabase":
            self.session.headers.update(
                {
                    "apikey": self.supabase_key,
                    "Authorization": f"Bearer {self.supabase_key}",
                }
            )
        self.sync_pub = self.create_publisher(String, "device_sync/status", 10)
        self.cpu_pub = self.create_publisher(Float32, "device_sync/cpu_usage", 10)
        self.timer = self.create_timer(self.poll_interval_sec, self._sync_once)
        self._last_cpu_total: Optional[int] = None
        self._last_cpu_idle: Optional[int] = None
        self._recording_started_at: Optional[float] = None
        self._ffmpeg_process: Optional[subprocess.Popen[str]] = None

        self.get_logger().info(
            f"web_bridge started: mode={self.mode}, device_id={self.device_id}"
        )
        if self.record_on_startup:
            self._ensure_recording()

    def _device_url(self) -> str:
        if self.mode == "supabase":
            return (
                f"{self.supabase_url}/rest/v1/{self.supabase_table}"
                f"?device_id=eq.{self.device_id}&select=*"
            )
        return f"{self.base_url}/api/devices/{self.device_id}"

    def _get_remote_device(self) -> Optional[Dict[str, Any]]:
        try:
            response = self.session.get(
                self._device_url(), timeout=self.request_timeout_sec
            )
            if self.mode == "backend" and response.status_code == 404:
                self.get_logger().error(f"device_id not found on server: {self.device_id}")
                return None
            response.raise_for_status()
            payload = response.json()
            if self.mode == "supabase":
                if not payload:
                    self.get_logger().error(
                        f"device_id not found in Supabase: {self.device_id}"
                    )
                    return None
                return payload[0]
            return payload
        except requests.RequestException as exc:
            self.get_logger().warning(f"GET device failed: {exc}")
            return None

    def _push_heartbeat(self) -> bool:
        self._ensure_recording()
        cpu_usage = self._read_cpu_usage_percent()
        cpu_text = "unknown" if cpu_usage is None else f"{cpu_usage:.1f}%"
        recording_duration = self._recording_duration_sec()
        is_recording = self._is_recording()
        now_iso = datetime.now(timezone.utc).isoformat()
        payload = {
            "status": self.status,
            "last_seen": now_iso,
            "firmware_version": self.firmware_version or None,
            "notes": (
                f"ros2 heartbeat at {now_iso} | "
                f"cpu_usage={cpu_text} | recording={is_recording} | "
                f"recording_duration_sec={recording_duration}"
            ),
            "calibration": {
                "runtime": {
                    "powered_on": True,
                    "is_recording": is_recording,
                    "recording_duration_sec": recording_duration,
                    "recording_dir": self.recording_dir,
                    "cpu_usage_percent": cpu_usage,
                    "updated_at": now_iso,
                }
            },
        }
        try:
            if self.mode == "supabase":
                response = self.session.patch(
                    self._device_url(),
                    json=payload,
                    headers={"Prefer": "return=representation"},
                    timeout=self.request_timeout_sec,
                )
            else:
                response = self.session.put(
                    self._device_url(), json=payload, timeout=self.request_timeout_sec
                )
            response.raise_for_status()
            if cpu_usage is not None:
                self._publish_cpu(cpu_usage)
            return True
        except requests.RequestException as exc:
            self.get_logger().warning(f"PUT heartbeat failed: {exc}")
            return False

    def _sync_once(self) -> None:
        remote_device = self._get_remote_device()
        if remote_device is None:
            self._publish_sync("get_failed")
            return

        ok = self._push_heartbeat()
        message = "sync_ok" if ok else "put_failed"
        readable_name = remote_device.get("readable_name", "unknown")
        self.get_logger().info(f"sync result={message}, readable_name={readable_name}")
        self._publish_sync(message)

    def _publish_sync(self, status_text: str) -> None:
        msg = String()
        msg.data = status_text
        self.sync_pub.publish(msg)

    def _publish_cpu(self, cpu_usage_percent: float) -> None:
        msg = Float32()
        msg.data = float(cpu_usage_percent)
        self.cpu_pub.publish(msg)

    def _read_cpu_usage_percent(self) -> Optional[float]:
        try:
            with open("/proc/stat", "r", encoding="utf-8") as f:
                first_line = f.readline().strip()
        except OSError as exc:
            self.get_logger().warning(f"read /proc/stat failed: {exc}")
            return None

        parts = first_line.split()
        if len(parts) < 5 or parts[0] != "cpu":
            return None

        counters = [int(x) for x in parts[1:]]
        idle = counters[3] + (counters[4] if len(counters) > 4 else 0)
        total = sum(counters)

        if self._last_cpu_total is None or self._last_cpu_idle is None:
            self._last_cpu_total = total
            self._last_cpu_idle = idle
            return None

        total_delta = total - self._last_cpu_total
        idle_delta = idle - self._last_cpu_idle
        self._last_cpu_total = total
        self._last_cpu_idle = idle

        if total_delta <= 0:
            return None
        usage = (1.0 - (idle_delta / total_delta)) * 100.0
        return max(0.0, min(100.0, usage))

    def _ensure_recording(self) -> None:
        if not self.record_on_startup:
            return
        if self._is_recording():
            return

        try:
            os.makedirs(self.recording_dir, exist_ok=True)
        except OSError as exc:
            self.get_logger().error(f"create recording dir failed: {exc}")
            return

        file_name = f"camera_h264_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
        output_path = os.path.join(self.recording_dir, file_name)

        cmd = [
            "ffmpeg",
            "-f",
            "v4l2",
            "-input_format",
            "mjpeg",
            "-video_size",
            self.recording_resolution,
            "-framerate",
            str(self.recording_fps),
            "-i",
            self.recording_device,
            "-vf",
            "format=yuv420p",
            "-c:v",
            self.ffmpeg_codec,
            "-b:v",
            self.recording_bitrate,
            "-y",
            output_path,
        ]

        try:
            self._ffmpeg_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            self._recording_started_at = time.time()
            self.get_logger().info(
                "recording started: "
                + " ".join(shlex.quote(part) for part in cmd)
            )
        except OSError as exc:
            self._ffmpeg_process = None
            self._recording_started_at = None
            self.get_logger().error(f"start ffmpeg failed: {exc}")

    def _is_recording(self) -> bool:
        return (
            self._ffmpeg_process is not None
            and self._ffmpeg_process.poll() is None
        )

    def _recording_duration_sec(self) -> int:
        if not self._is_recording() or self._recording_started_at is None:
            return 0
        return int(max(0.0, time.time() - self._recording_started_at))

    def destroy_node(self) -> bool:
        if self._ffmpeg_process is not None and self._ffmpeg_process.poll() is None:
            self.get_logger().info("stopping ffmpeg recorder process")
            self._ffmpeg_process.terminate()
            try:
                self._ffmpeg_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._ffmpeg_process.kill()
        return super().destroy_node()


def main(args: Optional[list[str]] = None) -> None:
    rclpy.init(args=args)
    node = None
    try:
        node = WebBridgeNode()
        rclpy.spin(node)
    except Exception as exc:  # noqa: BLE001
        if node is not None:
            node.get_logger().error(f"web bridge crashed: {exc}")
        else:
            print(f"web bridge init failed: {exc}")
        raise
    finally:
        if node is not None:
            node.destroy_node()
        rclpy.shutdown()
