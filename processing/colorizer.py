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


def _rgb_to_lab(r: int, g: int, b: int) -> np.ndarray:
    bgr = np.uint8([[[b, g, r]]])
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    return lab[0][0].astype(float)


def _lab_to_hex(lab: np.ndarray) -> str:
    lab_img = np.clip(lab, 0, 255).astype(np.uint8).reshape(1, 1, 3)
    bgr = cv2.cvtColor(lab_img, cv2.COLOR_LAB2BGR)
    b_val, g_val, r_val = int(bgr[0][0][0]), int(bgr[0][0][1]), int(bgr[0][0][2])
    return f'#{r_val:02x}{g_val:02x}{b_val:02x}'


def cluster_colors(colors_rgb: List[Tuple[int, int, int]], threshold: int):
    """
    Greedy LAB clustering.

    Returns:
        assignments: list of 1-indexed cluster numbers (same length as input)
        clusters:   list of dicts with keys: number(int), hex(str), indices(list[int]),
                    rep_lab(np.ndarray)
    """
    labs = [_rgb_to_lab(r, g, b) for r, g, b in colors_rgb]
    clusters = []
    assignments = []

    for i, lab in enumerate(labs):
        best_idx = None
        best_dist = float('inf')

        for c_idx, cluster in enumerate(clusters):
            dist = float(np.linalg.norm(lab - cluster['rep_lab']))
            if dist < best_dist:
                best_dist = dist
                best_idx = c_idx

        if best_idx is not None and best_dist < threshold:
            clusters[best_idx]['indices'].append(i)
            member_labs = np.array([labs[j] for j in clusters[best_idx]['indices']])
            clusters[best_idx]['rep_lab'] = np.median(member_labs, axis=0)
            assignments.append(best_idx + 1)
        else:
            new_number = len(clusters) + 1
            clusters.append({
                'rep_lab': lab.copy(),
                'indices': [i],
                'number': new_number,
            })
            assignments.append(new_number)

    for cluster in clusters:
        cluster['hex'] = _lab_to_hex(cluster['rep_lab'])

    return assignments, clusters
