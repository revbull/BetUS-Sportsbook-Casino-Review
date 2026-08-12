import pytest
from src.scrapers.betus_scraper import fetch_promos

@pytest.fixture
def get_promos():
    def _get_promos(site: str):
        if site == "betus":
            return fetch_promos()
        return []
    return _get_promos