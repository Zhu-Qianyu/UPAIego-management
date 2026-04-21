import time
import psutil
import shutil

class SystemMonitor:
    def __init__(self):
        self.prev_time = time.time()

    def get_fps(self):
        now = time.time()
        fps = 1.0 / (now - self.prev_time + 1e-6)
        self.prev_time = now
        return fps

    def get_cpu(self):
        return psutil.cpu_percent(interval=0.01)

    def get_memory(self):
        return psutil.virtual_memory().percent

    def get_sd_free_gb(self, path="/mnt/sdcard"):
        try:
            total, used, free = shutil.disk_usage(path)
            return round(free / 1024 / 1024 / 1024, 2)
        except:
            return -1