import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_camera_uses_official_ucsd_link_without_embedding_streams():
    source = (ROOT / "app.js").read_text()
    html = (ROOT / "index.html").read_text()
    camera_block = source[source.index("function renderCamera"):source.index("function hourLabel")]

    assert "https://coollab.ucsd.edu/pierviz/" in html
    assert 'target="_blank"' in html
    assert 'rel="noopener noreferrer"' in html
    assert "portal.hdontap.com" not in source
    assert "portal.hdontap.com" not in html
    assert "createElement(\"iframe\")" not in camera_block
    assert "data.live_embed_url" not in camera_block


def test_camera_link_is_minimal_and_independent_from_grading():
    source = (ROOT / "app.js").read_text()
    html = (ROOT / "index.html").read_text()
    camera_block = source[source.index("function renderCamera"):source.index("function hourLabel")]

    assert "camera-config" not in camera_block
    assert "camera_display" not in camera_block
    assert "cameraImageForGrade(data.grade)" in camera_block
    assert "Scripps Pier cam" in html
    assert "<figcaption" not in html
    assert "Live camera &mdash; Scripps Pier" not in html
