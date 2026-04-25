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
