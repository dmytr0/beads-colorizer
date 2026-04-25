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


def detect_circles(image: np.ndarray) -> list:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (9, 9), 2)
    min_side = min(image.shape[:2])

    min_dist = max(1, min_side // 50)
    min_r = max(1, int(min_dist * 0.25))
    max_r = max(min_r + 1, int(min_dist * 0.55))

    circles = cv2.HoughCircles(
        blurred, cv2.HOUGH_GRADIENT, dp=1,
        minDist=min_dist, param1=50, param2=30,
        minRadius=min_r, maxRadius=max_r
    )

    if circles is None:
        return []

    circles = np.round(circles[0]).astype(int)

    # Second pass: tighten radius bounds to median +/-30%
    median_r = int(np.median(circles[:, 2]))
    tight_min_r = max(1, int(median_r * 0.7))
    tight_max_r = max(tight_min_r + 1, int(median_r * 1.3))

    circles2 = cv2.HoughCircles(
        blurred, cv2.HOUGH_GRADIENT, dp=1,
        minDist=min_dist, param1=50, param2=30,
        minRadius=tight_min_r, maxRadius=tight_max_r
    )

    if circles2 is None:
        return [(int(c[0]), int(c[1]), int(c[2])) for c in circles]

    return [(int(c[0]), int(c[1]), int(c[2])) for c in circles2[0]]
