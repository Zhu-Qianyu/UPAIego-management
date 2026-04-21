from cv_bridge import CvBridge
from sensor_msgs.msg import Image

class ImagePublisher:
    def __init__(self, node, topic_name):
        self.node = node
        self.bridge = CvBridge()
        self.pub = node.create_publisher(Image, topic_name, 10)

    def publish(self, frame):
        msg = self.bridge.cv2_to_imgmsg(frame, "bgr8")
        self.pub.publish(msg)