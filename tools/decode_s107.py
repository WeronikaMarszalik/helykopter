import re,sys
def frames(path):
    txt=open(path,errors='replace').read()
    out=[];first=[]
    for l in txt.split('\n'):
        m=re.match(r'(\d\d:\d\d:\d\d\.\d+) > ?(.*)$',l)
        out.append(m.group(2) if m else l)
    j='\n'.join(out); seen=set();res=[]
    for lab,c,proto,ov,n,vals in re.findall(r'\[([A-Za-z0-9_\-]+) #(\d+)\] protocol=(\w+)( OVERFLOW)?\s*uint16_t rawData\[(\d+)\] = \{([\d,\s]*)\};',j):
        v=[int(x) for x in vals.split(',') if x.strip()]
        if len(v)!=int(n): continue
        k=(lab,c,tuple(v))
        if k in seen: continue
        seen.add(k); res.append((lab,int(c),v))
    return res
def dec(v):
    if not (1700<v[0]<2500 and 1700<v[1]<2300): return None
    p=v[2:]; bits=[]; i=0
    while i<len(p):
        on=p[i]; n=1 if on<700 else (2 if on<1400 else 3)
        if i+1>=len(p): break           # stop mark
        off=p[i+1]
        bits+= [0]*(n-1)+[1 if off>420 else 0]
        i+=2
    return bits if len(bits)==32 else None
if __name__=='__main__':
    fr=frames(sys.argv[1]); last=None;n=0;ok=0
    for lab,c,v in fr:
        b=dec(v)
        if not b: continue
        ok+=1; x=int(''.join(map(str,b)),2)
        if x==last: n+=1; continue
        if last is not None: print('  x%d'%n)
        print('#%d %s'%(c,'%02X %02X %02X %02X'%tuple(x.to_bytes(4,'big'))),''.join(map(str,b)),end=''); last=x;n=1
    print('  x%d'%n); print(len(fr),'frames',ok,'decoded')
