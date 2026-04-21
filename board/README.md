# Board ROS2 Bridge

这个目录提供一个可直接放到鲁班猫 3（Ubuntu + ROS2）上的 ROS2 工程，用于和本项目网站设备管理交互。

## 功能

- 定时向网站上报设备心跳（更新 `status`、`firmware_version`、`notes`）
- 按设备 `device_id` 拉取网站侧最新设备信息
- 支持两种模式：`supabase` 直连（默认）和 `backend` API 模式
- 启动节点后自动调用 `ffmpeg` 录制视频到 `/home/cat/videos`
- 实时上报运行状态：是否开机、是否录制中、累计录制时长、CPU 占用率

## 目录结构

- `ros2_web_bridge/`：ROS2 Python 包
- `ros2_web_bridge/config/bridge_params.yaml`：参数示例
- `ros2_web_bridge/launch/web_bridge.launch.py`：启动文件

## 快速使用

1. 安装依赖（在板子上）

```bash
sudo apt update
sudo apt install -y python3-requests
```

2. 编译 ROS2 工程

```bash
cd board
colcon build
source install/setup.bash
```

3. 配置参数

编辑 `ros2_web_bridge/config/bridge_params.yaml`：

- `mode`：`supabase` 或 `backend`
- 若 `supabase`：
  - `supabase_url`：例如 `https://xxxx.supabase.co`
  - `supabase_key`：Supabase key（需有对应表更新权限）
  - `device_id`：设备记录对应的 `device_id`
- 若 `backend`：
  - `base_url`：例如 `http://192.168.1.100:8000`
- 录制参数：
  - `record_on_startup`：是否自动开始录制
  - `recording_device`：摄像头设备，例如 `/dev/video0`
  - `recording_dir`：视频目录，默认 `/home/cat/videos`
  - `recording_resolution`：默认 `2560x720`
  - `recording_fps`：默认 `60`
  - `recording_bitrate`：默认 `5000k`
  - `ffmpeg_codec`：默认 `h264_rkmpp`

4. 运行

```bash
ros2 launch ros2_web_bridge web_bridge.launch.py
```

## 对接方式

### 1) Supabase 直连（默认）

- `GET /rest/v1/devices?device_id=eq.<id>&select=*`
- `PATCH /rest/v1/devices?device_id=eq.<id>&select=*`

### 2) FastAPI 后端模式

- `GET /api/devices/{device_id}`：拉取设备信息
- `PUT /api/devices/{device_id}`：上报心跳状态

如需扩展（例如 ROS topic/日志回传），可在 `web_bridge/node.py` 中添加更多 API 调用。

## 开机自启动（推荐）

1. 将服务文件复制到系统目录：

```bash
sudo cp board/systemd/ros2_web_bridge.service /etc/systemd/system/
```

2. 修改服务文件里的 `WorkingDirectory`（按你的工作区路径）：

- `/home/cat/ros2_ws`

3. 启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable ros2_web_bridge
sudo systemctl start ros2_web_bridge
sudo systemctl status ros2_web_bridge
```
