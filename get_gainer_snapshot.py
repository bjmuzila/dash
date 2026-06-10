import json
import asyncio
import aiohttp

async def main():
    print("Loading existing local session token...")
    
    with open('tastytrade_token.json', 'r') as f:
        token_data = json.load(f)
        
    session_token = token_data.get('access_token')
    if not session_token:
        print("Error: Could not find 'access_token' in tastytrade_token.json.")
        return

    print("Fetching $TOP10PGSP snapshot via direct bearer request...")
    
    url = "https://api.tastytrade.com/market-data/by-type?indices=$TOP10PGSP"
    headers = {
        "Authorization": f"Bearer {session_token}",
        "Accept": "application/json"
    }

    async with aiohttp.ClientSession() as client:
        async with client.get(url, headers=headers) as response:
            if response.status == 200:
                res_json = await response.json()
                
                # Print the raw response so we can see exactly what tastytrade sent back
                print(f"\nRaw Server Response: {res_json}")
                
                data = res_json.get('data', [])
                
                # Safely verify if data has items before accessing index 0
                if isinstance(data, list) and len(data) > 0:
                    indicator = data[0]
                    print("\n--- Market Indicator Snapshot ---")
                    print(f"Symbol:       {indicator.get('symbol')}")
                    print(f"Last Mark:    {indicator.get('mark')}")
                else:
                    print("\n[!] Connection successful, but 'data' is currently empty.")
                    print("    Note: dxFeed market indicator matrices ($TOP10...) are typically offline/empty on weekends.")
            else:
                print(f"\nRequest failed. Status Code: {response.status}")
                print(await response.text())

if __name__ == '__main__':
    asyncio.run(main())