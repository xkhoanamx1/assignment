import json
import os
import urllib.request

key = os.environ.get('GEMINI_API_KEY')
if not key:
    raise SystemExit('Set GEMINI_API_KEY before running this script.')

prompt = 'Say hello'
payload = {
    'contents': [
        {'parts': [{'text': prompt}]}
    ]
}
data = json.dumps(payload).encode('utf-8')
req = urllib.request.Request(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
    data=data,
    headers={'Content-Type': 'application/json'},
    method='POST'
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print(r.read().decode('utf-8'))
except Exception as e:
    import traceback
    print('ERROR', e)
    print(traceback.format_exc())
