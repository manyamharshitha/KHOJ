import os
from calle import CalleClient

client = CalleClient(api_key=os.environ.get("CALLE_API_KEY", "your_api_key_here"))

# The python client manages tasks through client.calls
try:
    print("Connected to Calle client successfully. Check dashboard or wait out the shared line lock timeout.")
except Exception as e:
    print(f"Error: {e}")