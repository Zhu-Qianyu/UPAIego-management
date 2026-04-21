import rclpy
from rclpy.node import Node

from .camera_driver import CameraDriver
from .system_monitor import SystemMonitor
from .image_publisher import ImagePublisher
from .video_recorder import VideoRecorder

class UPAIEGODualCameraNode(Node):
    def __init__(self):
        super().__init__("upaiego_dual_camera_node")

        # ================== 下视摄像头 ==================
        self.cam_down = CameraDriver(device=1)
        self.pub_down = ImagePublisher(self, "/upaiego/down/image")
        self.rec_down = VideoRecorder("down")

        # ================== 环视摄像头 ==================
        self.cam_surrounding = CameraDriver(device=3)
        self.pub_surrounding = ImagePublisher(self, "/upaiego/surrounding/image")
        self.rec_surrounding = VideoRecorder("surrounding")

        # ================== 系统监控 ==================
        self.monitor = SystemMonitor()

        self.timer = self.create_timer(1/30.0, self.main_loop)
        self.get_logger().info("✅ UPAIEGO 双摄像头系统启动成功！")

    def main_loop(self):
        ret_down, frame_down = self.cam_down.read()
        ret_surrounding, frame_surrounding = self.cam_surrounding.read()

        if ret_down:
            self.pub_down.publish(frame_down)
            self.rec_down.write(frame_down)

        if ret_surrounding:
            self.pub_surrounding.publish(frame_surrounding)
            self.rec_surrounding.write(frame_surrounding)

        fps = self.monitor.get_fps()
        cpu = self.monitor.get_cpu()
        mem = self.monitor.get_memory()

        self.get_logger().info(
            f"FPS: {fps:.1f} | CPU: {cpu:.1f}% | RAM: {mem:.1f}%"
        )

    def destroy_node(self):
        self.cam_down.close()
        self.cam_surrounding.close()
        self.rec_down.release()
        self.rec_surrounding.release()
        super().destroy_node()

def main(args=None):
    rclpy.init(args=args)
    node = UPAIEGODualCameraNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()