"""
板端 MPU6050 陀螺仪 CSV 记录（与 web_bridge ffmpeg 录像同一会话文件对齐）。

依据野火 LubanCat-RK3576 手册 §18.8：/dev/i2c-7、从机 0x68、GYRO_XOUT_H=0x43。
需安装: pip install smbus2（见 ros2_web_bridge setup.py）。
"""
from __future__ import annotations

import csv
import threading
import time
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    pass

try:
    import smbus2
except ImportError:
    smbus2 = None  # type: ignore

MPU6050_ADDR = 0x68
PWR_MGMT_1 = 0x6B
SMPLRT_DIV = 0x19
CONFIG = 0x1A
ACCEL_CONFIG = 0x1C
GYRO_XOUT_H = 0x43


def _mpu6050_init(bus: "smbus2.SMBus") -> None:
    bus.write_byte_data(MPU6050_ADDR, PWR_MGMT_1, 0x00)
    bus.write_byte_data(MPU6050_ADDR, SMPLRT_DIV, 0x07)
    bus.write_byte_data(MPU6050_ADDR, CONFIG, 0x06)
    bus.write_byte_data(MPU6050_ADDR, ACCEL_CONFIG, 0x01)


def _signed16(hi: int, lo: int) -> int:
    v = (hi << 8) | lo
    if v >= 0x8000:
        v -= 0x10000
    return v


def _read_gyro_xyz(bus: "smbus2.SMBus") -> tuple[int, int, int]:
    data = bus.read_i2c_block_data(MPU6050_ADDR, GYRO_XOUT_H, 6)
    return (
        _signed16(data[0], data[1]),
        _signed16(data[2], data[3]),
        _signed16(data[4], data[5]),
    )


class GyroRecorder:
    """后台线程写 gyro CSV；start/stop 与板端录像生命周期绑定。"""

    def __init__(
        self,
        csv_path: str,
        i2c_bus: int = 7,
        interval_sec: float = 0.01,
    ) -> None:
        self._csv_path = csv_path
        self._i2c_bus = i2c_bus
        self._interval_sec = interval_sec
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._logger = None

    def set_logger(self, logger) -> None:
        self._logger = logger

    def _log(self, level: str, msg: str) -> None:
        if self._logger is None:
            return
        getattr(self._logger, level)(msg)

    def start(self) -> bool:
        if smbus2 is None:
            self._log("warning", "gyro: smbus2 not installed, skip gyro logging")
            return False
        if self._thread is not None and self._thread.is_alive():
            return True
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="gyro_recorder", daemon=True)
        self._thread.start()
        return True

    def stop(self, timeout: float = 2.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    def _run(self) -> None:
        try:
            bus = smbus2.SMBus(self._i2c_bus)
        except OSError as e:
            self._log("error", f"gyro: cannot open I2C bus {self._i2c_bus}: {e}")
            return
        try:
            _mpu6050_init(bus)
        except OSError as e:
            self._log("error", f"gyro: MPU6050 init failed: {e}")
            try:
                bus.close()
            except OSError:
                pass
            return

        t0 = time.monotonic()
        try:
            with open(self._csv_path, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["mono_ts_sec", "gyro_x", "gyro_y", "gyro_z"])
                f.flush()
                while not self._stop.is_set():
                    gx, gy, gz = _read_gyro_xyz(bus)
                    t = time.monotonic() - t0
                    w.writerow([f"{t:.6f}", gx, gy, gz])
                    f.flush()
                    time.sleep(self._interval_sec)
        except OSError as e:
            self._log("error", f"gyro: read/write failed: {e}")
        finally:
            try:
                bus.close()
            except OSError:
                pass
