/* A paired phone supplies barcode input only; inventory changes stay on the laptop. */
(() => {
  const $ = (s) => document.querySelector(s);
  const isPhone = location.pathname === '/scan-phone';
  const random = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
  let pair = null,
    receiving = false,
    lastApplied = '',
    pendingPhone = null,
    phonePair = null;
  async function request(action, data = {}, phone = false) {
    const r = await fetch('/api/scanner/' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(phone ? { 'X-Scanner-Token': phonePair.token } : {}),
      },
      body: JSON.stringify(
        phone ? { ...data, channel: phonePair.channel, device: phonePair.device } : data,
      ),
    });
    const result = await r.json();
    if (!r.ok) {
      const error = Error(result.error || 'Scanner request failed');
      error.status = r.status;
      throw error;
    }
    return result;
  }
  function phoneMessage(message) {
    $('#phoneScannerStatus').textContent = message;
  }
  function laptopMessage(message) {
    $('#scannerLaptopStatus').textContent = message;
  }
  function lockPhone(locked) {
    $('#phoneTakePhoto').disabled = locked;
    $('#phoneSend').disabled = locked;
    $('#phoneCode').disabled = locked;
  }
  async function send(code) {
    if (!phonePair) return;
    code = String(code).trim();
    $('#phoneCode').value = code;
    if (!code) {
      phoneMessage('Scan or enter a barcode first.');
      return;
    }
    if (!pendingPhone || pendingPhone.code !== code) pendingPhone = { code, scan_id: random() };
    try {
      lockPhone(true);
      const r = await request('send', pendingPhone, true);
      if (r.status === 'applied') {
        pendingPhone = null;
        phoneMessage('Received by laptop. Review the item there.');
      } else phoneMessage('Sent. Waiting for laptop to fill the selected form…');
    } catch (e) {
      phoneMessage(
        e.message + ' You can retry Send to laptop; the same scan will not be queued twice.',
      );
      lockPhone(false);
    }
  }
  async function phoneTick() {
    if (!phonePair) return;
    try {
      const r = await request('status', { scan_id: pendingPhone?.scan_id || '' }, true);
      if (pendingPhone && r.status === 'applied') {
        pendingPhone = null;
        $('#phoneCode').value = '';
      }
      if (!pendingPhone)
        phoneMessage(
          r.ready
            ? 'Connected. Ready to scan for ' + r.target + '.'
            : 'Received by laptop. Finish the item there and click Ready for next scan.',
        );
      if (pendingPhone && !r.status)
        phoneMessage('Delivery was not confirmed. Retry Send to laptop.');
      lockPhone((!!pendingPhone && r.status === 'pending') || !r.ready);
    } catch (e) {
      phoneMessage(e.message);
      lockPhone(true);
      if ([403, 409, 410].includes(e.status)) {
        phonePair = null;
        sessionStorage.removeItem('erpScannerPair');
      }
    }
    if (phonePair) setTimeout(phoneTick, 1200);
  }
  async function laptopTick() {
    const current = pair;
    if (!current) return;
    try {
      const r = await request('poll', { channel: current.channel });
      if (pair !== current) return;
      if (r.connected && $('#pairScannerDialog').open) $('#pairScannerDialog').close();
      $('#scannerReady').hidden = false;
      $('#scannerReady').disabled = receiving;
      if (!r.pending)
        laptopMessage(
          !r.connected
            ? 'Phone scanner: waiting for phone. Open the pairing link on the same Wi-Fi.'
            : r.ready
              ? 'Phone scanner connected · ' + current.target + ' · Ready'
              : 'Scan received. Finish the item, then click Ready for next scan.',
        );
      if (r.pending && !receiving) {
        receiving = true;
        $('#scannerReady').disabled = true;
        try {
          const event = r.pending;
          if (lastApplied !== event.scan_id) {
            const accepted = await window.erpScan.receive(event.code, current.target);
            if (!accepted) {
              laptopMessage(
                'Scan waiting. Return to the selected ' +
                  current.target +
                  ' form and close other dialogs.',
              );
              return;
            }
            lastApplied = event.scan_id;
          }
          await request('ack', { channel: current.channel, scan_id: event.scan_id });
          laptopMessage(
            'Scan received: ' + event.code + '. Review the item, then click Ready for next scan.',
          );
        } finally {
          receiving = false;
          $('#scannerReady').disabled = false;
        }
      }
    } catch (e) {
      laptopMessage(e.message);
      if ([401, 403, 410].includes(e.status)) {
        pair = null;
        $('#scannerReady').hidden = true;
      }
    } finally {
      if (pair === current) setTimeout(laptopTick, 900);
    }
  }
  window.scannerBridge = { isPhone, send };
  document.addEventListener('DOMContentLoaded', async () => {
    if (isPhone) {
      $('#login').hidden = true;
      $('#workspace').hidden = true;
      $('#phoneScanner').hidden = false;
      const fragment = new URLSearchParams(location.hash.slice(1));
      try {
        phonePair = fragment.get('token')
          ? { channel: fragment.get('channel'), token: fragment.get('token'), device: random() }
          : JSON.parse(sessionStorage.getItem('erpScannerPair') || 'null');
        if (!phonePair?.channel || !phonePair?.token)
          throw Error('Open the pairing QR/link shown on your laptop.');
        sessionStorage.setItem('erpScannerPair', JSON.stringify(phonePair));
        history.replaceState(null, '', '/scan-phone');
        $('#phoneTakePhoto').onclick = () => window.erpScan.scanPhone();
        $('#phoneSendForm').onsubmit = (e) => {
          e.preventDefault();
          send($('#phoneCode').value);
        };
        lockPhone(true);
        await request('connect', {}, true);
        phoneMessage('Connected to laptop.');
        phoneTick();
      } catch (e) {
        phoneMessage(e.message);
        lockPhone(true);
      }
      return;
    }
    $('#pairPhone').onclick = () => $('#pairScannerDialog').showModal();
    $('#closePairing').onclick = () => $('#pairScannerDialog').close();
    $('#startPairing').onclick = async () => {
      const button = $('#startPairing');
      button.disabled = true;
      try {
        if (pair) await request('disconnect', { channel: pair.channel });
        pair = null;
        lastApplied = '';
        const target = $('#pairTarget').value;
        window.erpScan.prepare(target);
        const info = await fetch('/api/info').then((r) => r.json());
        // A phone cannot open the laptop's localhost address.
        const host = !['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)
          ? location.origin
          : info.phoneUrl;
        if (!host)
          throw Error(
            'No LAN address detected. Connect the laptop to Wi-Fi and restart the server.',
          );
        const created = await request('create', { target });
        pair = created;
        const link = new URL('/scan-phone', host);
        link.hash = new URLSearchParams({
          channel: created.channel,
          token: created.token,
        }).toString();
        const qr = window.qrcode(0, 'M');
        qr.addData(link.href);
        qr.make();
        $('#pairQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
        const svg = $('#pairQr svg');
        svg.style.cssText = 'width:260px;max-width:100%;background:white';
        $('#pairLink').textContent = '';
        const a = document.createElement('a');
        a.href = link.href;
        a.textContent = link.href;
        a.style.overflowWrap = 'anywhere';
        $('#pairLink').append(a);
        $('#pairStatus').textContent =
          'Scan with your phone camera to open scanner mode. Pairing expires in 10 minutes if unused. Keep the link private.';
        $('#pairScannerDialog').close();
        $('#pairScannerDialog').showModal();
        laptopTick();
      } catch (e) {
        $('#pairStatus').textContent = e.message;
      } finally {
        button.disabled = false;
      }
    };
    $('#scannerReady').onclick = async () => {
      if (!pair || receiving) return;
      try {
        window.erpScan.prepare(pair.target);
        await request('ready', { channel: pair.channel });
        laptopMessage('Ready for next scan.');
      } catch (e) {
        laptopMessage(e.message);
      }
    };
    $('#stopPairing').onclick = async () => {
      try {
        if (pair) await request('disconnect', { channel: pair.channel });
        pair = null;
        $('#pairQr').textContent = '';
        $('#pairLink').textContent = '';
        $('#pairStatus').textContent = 'Disconnected.';
        $('#scannerReady').hidden = true;
        laptopMessage('Phone scanner disconnected.');
      } catch (e) {
        $('#pairStatus').textContent = e.message;
      }
    };
  });
})();
