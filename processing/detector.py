import cv2
import numpy as np


def upscale(image: np.ndarray, target: int = 2000) -> np.ndarray:
    h, w = image.shape[:2]
    min_side = min(h, w)
    if min_side >= target:
        return image
    scale = target / min_side
    new_w = int(w * scale)
    new_h = int(h * scale)
    return cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
