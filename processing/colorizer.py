import cv2
import numpy as np
from typing import Tuple, List


def sample_circle_color(image: np.ndarray, cx: int, cy: int, radius: int) -> Tuple[int, int, int]:
    """Return median RGB of pixels within 60% of circle radius from center."""
    h, w = image.shape[:2]
    inner_r = max(1, int(radius * 0.6))
    y_idx, x_idx = np.ogrid[:h, :w]
    mask = (x_idx - cx) ** 2 + (y_idx - cy) ** 2 <= inner_r ** 2
    pixels = image[mask]  # shape (N, 3), BGR
    median_bgr = np.median(pixels, axis=0).astype(int)
    return int(median_bgr[2]), int(median_bgr[1]), int(median_bgr[0])  # RGB
