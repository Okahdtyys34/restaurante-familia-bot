const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function panel({ day, current, draft, fee, orders, statuses, csrf, notice, configured, voice, used, limit }) {
  const field = `<input type="hidden" name="csrf" value="${csrf}">`;
  const cards = orders.map(order => {
    const contact = /^\d{8,15}$/.test(order.sender) ? `<p><a href="https://wa.me/${order.sender}" target="_blank" rel="noopener noreferrer">Abrir conversa com o cliente</a></p>` : '';
    return `<article><h3>Pedido #${order.id} · ${esc(order.day)}</h3><pre>${esc(order.receipt)}</pre>${contact}
      <form method="post" action="/admin/status">${field}<input type="hidden" name="id" value="${order.id}">
        <label>Andamento <select name="status">${statuses.map(status => `<option${status === order.status ? ' selected' : ''}>${status}</option>`).join('')}</select></label>
        <button>Salvar status</button>
      </form></article>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Painel · Restaurante da Família</title><style>
      *{box-sizing:border-box}body{font:16px/1.5 system-ui;margin:auto;max-width:720px;padding:24px;background:#f5f3ec;color:#203e35}
      h1,h2,h3{line-height:1.2}section,article{background:#fff;border:1px solid #dbe3d6;border-radius:14px;padding:16px;margin:16px 0}
      textarea{display:block;width:100%;margin:8px 0 14px;padding:10px;min-height:140px;border:1px solid #839689;border-radius:8px;font:inherit}
      button{background:#245a45;color:#fff;border:0;border-radius:8px;padding:10px 14px;font:inherit;cursor:pointer;margin:5px 0}
      select{font:inherit;max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.notice{padding:12px;background:#fff4d4;border-radius:8px}a{color:#245a45}
    </style></head><body><main><strong>Restaurante da Família</strong><h1>Painel do restaurante</h1>
    ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
    ${configured ? '' : '<p class="notice">O bot aguarda a configuração da Meta. Você já pode publicar um cardápio.</p>'}
    <section><h2>Limite de mensagens</h2><p>${used} de ${limit} tentativas nos últimos 32 dias.
      ${used >= limit ? '<strong>Envio pausado até liberar saldo.</strong>' : ''} Áudio na nuvem ${voice ? 'habilitado' : 'desabilitado'}.</p></section>
    <section><h2>Cardápio de hoje</h2><p>${day} · ${current ? `${current.items.length} itens publicados` : 'Aguardando publicação'} · Entrega ${fee}</p>
      <form method="post" action="/admin/menu">${field}<input type="hidden" name="day" value="${day}">
        <label for="items">Um item por linha no formato <strong>Prato | preço</strong>.</label>
        <textarea id="items" name="items" maxlength="1900" required placeholder="Feijoada | 28,00&#10;Frango grelhado | 22,00">${esc(draft)}</textarea>
        <button>Publicar cardápio de hoje</button>
      </form><p>O cardápio vale até o fim do dia.</p></section>
    <section><h2>Pedidos recebidos</h2><p>Recarregue a página para conferir novos pedidos.</p>${cards || '<p>Ainda não há pedidos.</p>'}</section>
    </main></body></html>`;
}
