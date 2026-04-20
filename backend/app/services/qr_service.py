"""QR code generation for devices."""

from __future__ import annotations

import io
import json

import qrcode
from PIL import Image, ImageDraw, ImageFont
from qrcode.constants import ERROR_CORRECT_M


def generate_qr_png(device_id: str, readable_name: str) -> bytes:
    """Generate a QR code PNG encoding the device identity as JSON.

    Payload: {"readable_name": "...", "device_id": "..."}
    Returns the PNG image as raw bytes.
    """
    payload = json.dumps(
        {"readable_name": readable_name, "device_id": device_id},
        separators=(",", ":"),
    )

    # 1. 先生成二维码
    qr = qrcode.QRCode(
        version=None,  # 自动大小
        error_correction=ERROR_CORRECT_M,
        box_size=16,  # 二维码每个点更大一点，原来是10
        border=2,  # 白边，4一般比较合适
    )
    qr.add_data(payload)
    qr.make(fit=True)

    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    # 2. 下面显示的设备号文字
    label = str(readable_name)

    try:
        font = ImageFont.truetype("arial.ttf", 108)  # 字体变大，原来是36
    except OSError:
        font = ImageFont.load_default()

    # 3. 计算文字尺寸
    temp_draw = ImageDraw.Draw(qr_img)
    text_bbox = temp_draw.textbbox((0, 0), label, font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_height = text_bbox[3] - text_bbox[1]

    # 4. 设置整体留白参数
    side_padding = 30  # 左右留白，避免太贴边
    top_padding = 20  # 顶部留白
    gap_between = 8  # 二维码和数字之间的间距
    bottom_padding = 48  # 数字距离底边的留白

    # 5. 为了让“最终图片整体尽量接近正方形”，重新计算画布
    content_width = max(qr_img.width, text_width) + side_padding * 2
    content_height = (
        top_padding + qr_img.height + gap_between + text_height + bottom_padding
    )

    # 取更大的边长，做成正方形画布
    canvas_size = max(round(content_width), round(content_height))

    final_img = Image.new("RGB", (canvas_size, canvas_size), "white")

    # 6. 把二维码居中放到上方区域
    qr_x = (canvas_size - qr_img.width) // 2
    qr_y = top_padding
    final_img.paste(qr_img, (qr_x, qr_y))

    # 7. 把设备号文字居中放到底部，但不要太靠边
    draw = ImageDraw.Draw(final_img)
    text_x = (canvas_size - text_width) // 2
    text_y = qr_y + qr_img.height + gap_between
    draw.text((text_x, text_y), label, fill="black", font=font)

    # 8. 导出 PNG
    buf = io.BytesIO()
    final_img.save(buf, format="PNG")
    return buf.getvalue()
