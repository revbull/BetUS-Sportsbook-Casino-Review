import pytest
from tests.conftest import get_promos
from pyats.topology import Device

@pytest.mark.betus
@pytest.mark.parametrize("site", ["betus"])
def test_betus_promos_changed(site, get_promos, device: Device):
    promos = get_promos(site)
    assert len(promos) == 5, "Expected 5 promos, but got {}".format(len(promos))
    expected_promos = [
        ("200% Bonus On Your First Crypto Deposit", "FIRST200"),
        ("75% Sports Crypto Re-up Bonus", "CRYPTO75"),
    ]
    for promo in expected_promos:
        assert promo in promos, "Expected promo '{}' with code '{}'".format(*promo)