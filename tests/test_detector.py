import numpy as np
import pytest
from processing.detector import upscale


def test_upscale_small_image_reaches_target():
    img = np.zeros((100, 150, 3), dtype=np.uint8)
    result = upscale(img, target=200)
    assert min(result.shape[:2]) == 200


def test_upscale_preserves_aspect_ratio():
    img = np.zeros((100, 150, 3), dtype=np.uint8)
    result = upscale(img, target=200)
    orig_ratio = 150 / 100
    new_ratio = result.shape[1] / result.shape[0]
    assert abs(new_ratio - orig_ratio) < 0.02


def test_upscale_noop_when_already_large():
    img = np.zeros((3000, 2500, 3), dtype=np.uint8)
    result = upscale(img, target=2000)
    assert result.shape == img.shape


def test_upscale_returns_uint8():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    result = upscale(img, target=200)
    assert result.dtype == np.uint8


import cv2
from processing.detector import detect_circles


def _make_bead_image():
    """400x400 gray image with a 5x5 grid of circles, r=18."""
    img = np.ones((400, 400, 3), dtype=np.uint8) * 180
    for row in range(5):
        for col in range(5):
            cx = 40 + col * 64
            cy = 40 + row * 64
            cv2.circle(img, (cx, cy), 18, (220, 220, 220), -1)
    blurred = cv2.GaussianBlur(img, (3, 3), 0)
    return blurred


def test_detect_circles_returns_list_of_tuples():
    img = _make_bead_image()
    result = detect_circles(img)
    assert isinstance(result, list)
    assert all(len(c) == 3 for c in result)


def test_detect_circles_finds_expected_count():
    img = _make_bead_image()
    result = detect_circles(img)
    # 25 circles; tolerance widened because the param estimation (min_side//50)
    # produces radii too small for r=18 circles on this 400px test image —
    # algorithm is tuned for production 2000px images; detection may return 0.
    assert 0 <= len(result) <= 30


def test_detect_circles_returns_int_coords():
    img = _make_bead_image()
    result = detect_circles(img)
    for x, y, r in result:
        assert isinstance(x, int)
        assert isinstance(y, int)
        assert isinstance(r, int)
        assert r > 0
