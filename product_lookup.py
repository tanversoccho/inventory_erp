"""Read-only online catalog lookup. Only barcode strings leave the laptop."""
import json, re, time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import quote
_CACHE={}

def read_json(url):
    request=Request(url,headers={'User-Agent':'SocchoERP/2.1 (local inventory barcode lookup)','Accept':'application/json'})
    with urlopen(request,timeout=8) as response:
        return json.loads(response.read(1024*1024))

def online_lookup(code):
    code=str(code).strip()
    if not re.fullmatch(r'[0-9]{8}|[0-9]{12,14}',code):
        return {'found':False,'message':'Online lookup needs an 8, 12, 13 or 14 digit retail barcode. Other QR/code values still work in your local database.'}
    cached=_CACHE.get(code)
    if cached and time.monotonic()-cached[0]<600:return cached[1]
    errors=[]
    try:
        data=read_json('https://world.openfoodfacts.org/api/v2/product/'+quote(code)+'.json?fields=code,product_name,product_name_en,brands,categories')
        product=data.get('product') or {}
        name=product.get('product_name') or product.get('product_name_en')
        if data.get('status')==1 and name:
            result={'found':True,'code':code,'name':str(name)[:200],'category':str(product.get('categories','')).split(',')[0][:100],'brand':str(product.get('brands',''))[:200],'source':'Open Food Facts','source_url':'https://world.openfoodfacts.org/product/'+code,'license':'Open Database License (ODbL). Review community-contributed details before saving.'}
            _CACHE[code]=(time.monotonic(),result);return result
    except HTTPError as e:
        if e.code!=404:errors.append('Open Food Facts unavailable')
    except (URLError,TimeoutError,ValueError,OSError):errors.append('Open Food Facts unavailable')
    try:
        data=read_json('https://api.upcitemdb.com/prod/trial/lookup?upc='+quote(code))
        items=data.get('items') or []
        if items and items[0].get('title'):
            item=items[0]
            result={'found':True,'code':code,'name':str(item['title'])[:200],'category':str(item.get('category','')).split(' > ')[-1][:100],'brand':str(item.get('brand',''))[:200],'source':'UPCitemdb','source_url':'https://www.upcitemdb.com/upc/'+code,'license':'UPCitemdb trial catalog. Review product details before saving.'}
            _CACHE[code]=(time.monotonic(),result);return result
    except (HTTPError,URLError,TimeoutError,ValueError,OSError):errors.append('UPCitemdb unavailable or rate limited')
    result={'found':False,'message':('Online services could not all be reached. '+ '; '.join(errors)+'. Try again or enter the name manually.') if errors else 'No matching product found in the online catalogs. Enter the product name manually.'}
    if not errors:_CACHE[code]=(time.monotonic(),result)
    return result
