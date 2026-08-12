from bs4 import BeautifulSoup
import requests
from typing import List, Tuple

def fetch_promos() -> List[Tuple[str, str]]:
    url = "https://www.betus.com.pa/promotions/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.content, 'html.parser')
    promo_listings = soup.find_all('div', class_='promo-item')
    
    promos = []
    for item in promo_listings:
        title_tag = item.find('h3')
        code_tag = item.find('span', string=lambda x: x and 'Promo Code:' in x)
        
        if not title_tag or not code_tag:
            continue
            
        title = title_tag.get_text(strip=True)
        code = code_tag.get_text(strip=True).replace('Promo Code:', '').strip()
        
        # Normalize known title variations
        if "200% Bonus on your First Crypto Deposit" in title:
            title = "200% Bonus On Your First Crypto Deposit"
        elif "75% Sports Crypto Re-up Bonus" in title:
            title = "75% Sports Crypto Re-up Bonus"
        elif "50% Sports Re-up Bonus" in title:
            title = "50% Sports Re-up Bonus"
        elif "100% Crypto Re-up Bonus" in title:
            title = "100% Crypto Re-up Bonus"
        elif "100% Casino Re-up Bonus" in title:
            title = "100% Casino Re-up Bonus"
            
        promos.append((title, code))
    
    return promos