from collections import Counter

path = r'C:\Users\sdsle\.lightcode-dev\logs\terminal\b3136d0c-7faf-435d-8789-56aeb90bf279.log'
with open(path, 'rb') as f:
    data = f.read()
print(f'size: {len(data)}')

ESC_BSLASH = b'\x1b' + b'\x5c'

# Find every OSC start: ESC ]
osc_types = Counter()
i = 0
while True:
    j = data.find(b'\x1b]', i)
    if j < 0:
        break
    k = j + 2
    while k < len(data) and 0x30 <= data[k] <= 0x39:
        k += 1
    num = data[j + 2:k].decode('ascii', errors='replace') or '(bare)'
    osc_types[num] += 1
    i = k

print('OSC number counts:')
for k, v in osc_types.most_common():
    print(f'  OSC {k}  x{v}')

# Extract OSC 9 events specifically
i = 0
events = []
while True:
    j = data.find(b'\x1b]9', i)
    if j < 0:
        break
    k = j + 3
    end = -1
    while k < len(data):
        b = data[k]
        if b == 0x07:
            end = k
            break
        if b == 0x1b and k + 1 < len(data) and data[k + 1] == 0x5c:
            end = k + 1
            break
        k += 1
    if end < 0:
        i = j + 3
        continue
    events.append(data[j:end + 1])
    i = end + 1

print(f'\nOSC 9 events: {len(events)}')
for e in events:
    rest = e[3:]
    if rest.endswith(b'\x07'):
        rest = rest[:-1]
    elif rest.endswith(ESC_BSLASH):
        rest = rest[:-2]
    if rest.startswith(b';'):
        sub = '(bare)'
        payload = rest[1:]
    else:
        semi = rest.find(b';')
        if semi >= 0:
            sub = rest[:semi].decode('ascii', errors='replace')
            payload = rest[semi + 1:]
        else:
            sub = rest.decode('ascii', errors='replace')
            payload = b''
    try:
        txt = payload.decode('utf-8', errors='replace')
    except Exception:
        txt = repr(payload)
    print(f'  [9;{sub}]  {txt[:250]!r}')
