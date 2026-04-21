from launch import LaunchDescription
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory
import os


def generate_launch_description() -> LaunchDescription:
    params_file = os.path.join(
        get_package_share_directory("ros2_web_bridge"),
        "config",
        "bridge_params.yaml",
    )
    return LaunchDescription(
        [
            Node(
                package="ros2_web_bridge",
                executable="web_bridge_node",
                name="web_bridge_node",
                output="screen",
                parameters=[params_file],
            )
        ]
    )
