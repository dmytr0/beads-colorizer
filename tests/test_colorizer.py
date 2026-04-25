import numpy as np
import cv2
import pytest
from processing.colorizer import sample_circle_color


def _solid_circle_image(color_bgr, cx=50, cy=50, r=20, size=100):
    img = np.ones((size, size, 3), dtype=np.uint8) * 128
    cv2.circle(img, (cx, cy), r, color_bgr, -1)
    return img


def test_sample_white_circle():
    img = _solid_circle_image((255, 255, 255))
    r, g, b = sample_circle_color(img, 50, 50, 20)
    assert r > 240 and g > 240 and b > 240


def test_sample_red_circle():
    img = _solid_circle_image((0, 0, 200))  # BGR: red
    r, g, b = sample_circle_color(img, 50, 50, 20)
    assert r > 150 and g < 50 and b < 50


def test_sample_returns_tuple_of_ints():
    img = _solid_circle_image((100, 150, 200))
    result = sample_circle_color(img, 50, 50, 20)
    assert len(result) == 3
    assert all(isinstance(v, int) for v in result)
    assert all(0 <= v <= 255 for v in result)


def test_sample_ignores_border_pixels():
    # Circle center is white; dark border ring added
    img = _solid_circle_image((255, 255, 255))
    cv2.circle(img, (50, 50), 20, (0, 0, 0), 2)
    r, g, b = sample_circle_color(img, 50, 50, 20)
    # Inner 60% radius should still read as white
    assert r > 200 and g > 200 and b > 200


from processing.colorizer import cluster_colors


def test_cluster_groups_identical_colors():
    colors = [(255, 255, 255), (255, 255, 255), (255, 255, 255)]
    assignments, clusters = cluster_colors(colors, threshold=30)
    assert assignments == [1, 1, 1]
    assert len(clusters) == 1


def test_cluster_separates_different_colors():
    colors = [(255, 255, 255), (255, 0, 0), (0, 200, 0)]
    assignments, clusters = cluster_colors(colors, threshold=30)
    assert len(set(assignments)) == 3
    assert len(clusters) == 3


def test_cluster_similar_colors_merge():
    # Two near-identical whites should merge at threshold=30
    colors = [(255, 255, 255), (250, 248, 252)]
    assignments, clusters = cluster_colors(colors, threshold=30)
    assert assignments[0] == assignments[1]


def test_cluster_assignments_length_matches_input():
    colors = [(100, 100, 100), (200, 100, 50), (10, 200, 10)]
    assignments, clusters = cluster_colors(colors, threshold=30)
    assert len(assignments) == 3


def test_cluster_hex_format():
    colors = [(255, 0, 0)]
    assignments, clusters = cluster_colors(colors, threshold=30)
    hex_val = clusters[0]['hex']
    assert hex_val.startswith('#')
    assert len(hex_val) == 7


def test_cluster_total_count():
    colors = [(255, 255, 255)] * 5 + [(255, 0, 0)] * 3
    assignments, clusters = cluster_colors(colors, threshold=30)
    total = sum(len(c['indices']) for c in clusters)
    assert total == 8
