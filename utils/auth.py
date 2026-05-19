import requests

def get_oauth2_token(client_id, client_secret, tenant_id, scope):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    payload = {
        'grant_type': 'client_credentials',
        'client_id': client_id,
        'client_secret': client_secret,
        'scope': scope
    }

    headers = {'Content-Type': 'application/x-www-form-urlencoded'}

    response = requests.post(url, headers=headers, data=payload)

    if response.status_code == 200:
        return response.json()['access_token']
    else:
        raise Exception(response.text)