import cv2

class CameraDriver:
    def __init__(self, device=1, width=1280, height=720, fps=30):
        self.cap = cv2.VideoCapture(device)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)

    # 这里必须叫 read()
    def read(self):
        return self.cap.read()

    def close(self):
        self.cap.release()