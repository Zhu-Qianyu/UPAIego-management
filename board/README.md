# Board ROS2 Bridge

这个目录提供一个可直接放到鲁班猫 3（Ubuntu + ROS2）上的 ROS2 工程，用于和本项目网站设备管理交互。

## 功能

- 定时向网站上报设备心跳（更新 `status`、`firmware_version`、`notes`）
- 按设备 `device_id` 拉取网站侧最新设备信息
- 支持两种模式：`supabase` 直连（默认）和 `backend` API 模式

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
