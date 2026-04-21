from setuptools import find_packages, setup

package_name = "ros2_web_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        (f"share/{package_name}/launch", ["launch/web_bridge.launch.py"]),
        (f"share/{package_name}/config", ["config/bridge_params.yaml"]),
    ],
    install_requires=["setuptools", "requests"],
    zip_safe=True,
    maintainer="fleet-dev",
    maintainer_email="dev@example.com",
    description="ROS2 bridge for website device management integration.",
    license="MIT",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "web_bridge_node = ros2_web_bridge.node:main",
        ],
    },
)
