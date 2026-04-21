import cv2
import os
import time
from datetime import datetime

class VideoRecorder:
    def __init__(self, side, width=1280, height=720, fps=30):
        self.side = side

        # ====================== 你要的路径 ======================
        # 根目录
        self.save_root = "/home/cat/videos"
        
        # 每次启动创建【时间戳文件夹】
        self.folder_name = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.save_dir = os.path.join(self.save_root, self.folder_name)
        
        # 创建目录
        os.makedirs(self.save_dir, exist_ok=True)

        # 开始录制时间（用于对齐）
        self.start_time = time.time()
        self.start_str = datetime.fromtimestamp(self.start_time).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

        # 视频文件名
        filename = os.path.join(self.save_dir, f"{side}.mp4")
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self.writer = cv2.VideoWriter(filename, fourcc, fps, (width, height))

        # 保存时间戳日志
        self.save_timestamp()

    def save_timestamp(self):
        log_path = os.path.join(self.save_dir, "timestamps.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{self.side}] 开始录制: {self.start_str} | 时间戳: {self.start_time:.3f}\n")

    def write(self, frame):
        self.writer.write(frame)

    def release(self):
        self.writer.release()