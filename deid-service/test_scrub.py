import json
import re
from datetime import datetime
from pathlib import Path

import pytest

from app.scrub import ScrubConfig, scrub_resource

SAMPLE = json.loads((Path(__file__).parent / "sample_bundle.json").read_text())


def _parts(bundle):
    patient = next(
        e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Patient"
    )
    observations = [
        e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Observation"
    ]
    return patient, observations


def _shape(node):
    if isinstance(node, dict):
        return {k: _shape(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_shape(v) for v in node]
    return type(node).__name__


def _scrub(config=None):
    out, mapping = scrub_resource(SAMPLE, config or ScrubConfig())
    return out


def test_identifying_fields_change():
    out = _scrub()
    orig_patient, _ = _parts(SAMPLE)
    patient, _ = _parts(out)

    assert patient["name"][0]["family"] != orig_patient["name"][0]["family"]
    assert patient["name"][0]["given"] != orig_patient["name"][0]["given"]
    assert patient["birthDate"] != orig_patient["birthDate"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", patient["birthDate"])

    phone = next(t for t in patient["telecom"] if t["system"] == "phone")
    orig_phone = next(t for t in orig_patient["telecom"] if t["system"] == "phone")
    assert phone["value"] != orig_phone["value"]

    email = next(t for t in patient["telecom"] if t["system"] == "email")
    assert email["value"] != "maria.gonzalez@example.com"

    mrn = patient["identifier"][0]
    assert mrn["value"] != "MRN-483920"
    assert mrn["system"] == "http://hospital.smarthealth.org/mrn"


def test_mrn_keeps_format():
    patient, _ = _parts(_scrub())
    # Same shape as MRN-483920: 3 uppercase letters, a dash, 6 digits.
    assert re.fullmatch(r"[A-Z]{3}-\d{6}", patient["identifier"][0]["value"])


def test_state_preserved_postal_truncated():
    patient, _ = _parts(_scrub())
    addr = patient["address"][0]
    assert addr["state"] == "CA"
    assert addr["postalCode"] == "941"
    assert addr["city"] != "San Francisco"
    assert addr["line"][0] != "742 Evergreen Terrace"
    assert "742 Evergreen Terrace" not in addr["text"]


def test_same_input_maps_to_same_output():
    out = _scrub()
    patient, _ = _parts(out)
    name = patient["name"][0]
    # name.text is rebuilt from the same surrogates as given/family.
    assert name["given"][0] in name["text"]
    assert name["family"] in name["text"]
    # Determinism: scrubbing the same input twice gives identical output.
    assert out == _scrub()


def test_event_intervals_preserved_by_date_shift():
    _, orig_obs = _parts(SAMPLE)
    _, obs = _parts(_scrub())

    def dt(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    orig_delta = dt(orig_obs[1]["effectiveDateTime"]) - dt(orig_obs[0]["effectiveDateTime"])
    new_delta = dt(obs[1]["effectiveDateTime"]) - dt(obs[0]["effectiveDateTime"])
    assert new_delta == orig_delta
    # Time-of-day is preserved; only the date component shifts.
    assert obs[0]["effectiveDateTime"].endswith("T09:30:00Z")


def test_output_same_shape_and_valid_json():
    out = _scrub()
    assert _shape(out) == _shape(SAMPLE)
    assert json.loads(json.dumps(out)) == out
    # References are untouched so the bundle stays internally consistent.
    _, obs = _parts(out)
    assert obs[0]["subject"]["reference"] == "Patient/patient-1"


def test_preserve_band_age_strategy():
    patient, _ = _parts(_scrub(ScrubConfig(age_strategy="preserve_band")))
    born = datetime.fromisoformat(patient["birthDate"]).date()
    age = (datetime.now().date() - born).days / 365.25
    # 1987-04-12 -> age ~39 in 2026 -> 35-39 band midpoint ~37.5
    assert 34 <= age <= 41
    assert patient["birthDate"] != "1987-04-12"


def test_http_endpoints():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert "llm" in health
    # No dstack socket outside a CVM -> graceful non-TEE response.
    assert client.get("/attestation").json()["tee"] is False

    resp = client.post("/scrub", json=SAMPLE)
    assert resp.status_code == 200
    assert resp.json()["resourceType"] == "Bundle"
    assert client.post("/scrub", content=b"not json").status_code == 400


def _spacy_model_available():
    try:
        import spacy

        spacy.load("en_core_web_sm")
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _spacy_model_available(), reason="spaCy en_core_web_sm not installed")
def test_freetext_scrubbing_consistent_with_structured_fields():
    out = _scrub(ScrubConfig(scrub_freetext=True))
    patient, obs = _parts(out)
    note = next(o for o in obs if o.get("code", {}).get("text") == "Clinical note")

    assert "Maria" not in note["valueString"]
    assert "Gonzalez" not in note["valueString"]
    assert "(415) 555-0132" not in note["valueString"]
    # The inline name maps through the SAME surrogate map as Patient.name.
    assert patient["name"][0]["given"][0] in note["valueString"]
    assert patient["name"][0]["family"] in note["valueString"]
