const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = cents => currency.format(cents / 100);

const homeOptions = ['Fazer pedido', 'Ver cardápio', 'Consultar último pedido', 'Falar com atendente'];
const paymentOptions = ['Pix combinado com a equipe', 'Cartão no recebimento', 'Dinheiro'];
const greeting = 'Olá! 💚 Sou o assistente do Restaurante da Família. Digite o número da opção.';

function normalizeDishName(text) {
  return text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function findDishOptions(input, items) {
  const phrase = normalizeDishName(input);
  const dish = phrase.replace(/^por favor /, '').replace(/ por favor$/, '')
    .replace(/^(?:eu )?(?:quero(?: pedir)?|vou querer|gostaria de(?: pedir)?|pode ser) /, '')
    .replace(/^(?:um|uma|o|a) /, '');
  if (!dish) return [];
  const options = items.map((item, index) => ({ name: normalizeDishName(item.name), number: index + 1 }));
  const exact = options.filter(option => option.name === phrase || option.name === dish);
  if (exact.length) return exact.map(option => option.number);
  return options.filter(option => option.name.startsWith(`${dish} `)).map(option => option.number);
}

export function respond(previous, incoming, menu, { lastOrder, fee, support, fromVoice = false }) {
  let session = previous ?? { step: 'home', cart: [] };
  let order;
  const { items, id } = menu ?? { items: [], id: null };
  const input = incoming?.trim().slice(0, 200) ?? '';
  const command = input.toLocaleLowerCase('pt-BR');
  const n = /^\d{1,3}$/.test(input) ? Number(input) : 0;

  function reply(step, text, options = []) {
    const body = [text, options.map((label, i) => `${i + 1} - ${label}`).join('\n')].filter(Boolean).join('\n\n');
    session.step = step;
    session.lastReply = body;
    return { session, body, order };
  }
  function home(text = greeting) {
    session = { step: 'home', cart: [] };
    return reply('home', text, homeOptions);
  }
  function catalog(prefix = '') {
    if (!menu) return home(`${prefix}O cardápio de hoje ainda não foi publicado.`);
    session.menuId = id;
    return reply('catalog', `${prefix}Cardápio do dia 🍲\nResponda com o número ou o nome do item.`, [
      ...items.map(item => `${item.name} · ${money(item.price)}`), 'Ver carrinho', 'Voltar ao menu',
    ]);
  }
  const lines = () => session.cart.map(item => `${item.qty}× ${item.name} — ${money(item.price * item.qty)}`).join('\n');
  const total = () => session.cart.reduce((sum, item) => sum + item.price * item.qty, 0) + (session.delivery ? fee : 0);
  function basket() {
    return session.cart.length
      ? reply('basket', `${lines()}\nTotal até agora: ${money(total())}`, ['Adicionar mais itens', 'Finalizar pedido', 'Remover um item', 'Cancelar pedido'])
      : catalog('Seu carrinho está vazio.\n\n');
  }
  function delivery() {
    return reply('delivery', 'Como prefere receber?', [`Entrega · ${money(fee)}`, 'Retirada · grátis']);
  }
  function review() {
    const fulfillment = session.delivery ? `Entrega: ${money(fee)}\nEndereço: ${session.address}` : 'Retirada no restaurante';
    const change = session.change ? ` · troco para ${money(session.change)}` : '';
    session.receipt = `${lines()}\n${fulfillment}\nNome: ${session.name}\nObservações: ${session.note}\nPagamento: ${session.payment}${change}\nTotal: ${money(total())}`;
    return reply('review', `Confira seu pedido 🧾\n\n${session.receipt}`, ['Enviar pedido', 'Alterar itens', 'Alterar entrega ou pagamento', 'Cancelar pedido']);
  }
  const invalid = () => ({ session, body: `Não entendi a resposta. Tente novamente ou digite MENU.\n\n${session.lastReply}` });

  if (session.menuId && session.menuId !== id) {
    session = { step: 'home', cart: [] };
    return catalog('O cardápio mudou e seu carrinho foi limpo. Confira as opções de hoje.\n\n');
  }
  if (command === 'menu' || /^(oi|olá|ola)[!.]?$/.test(command) && session.step === 'home') return reply('home', greeting, homeOptions);
  if (!previous) return home();
  if (!input) return { session, body: 'Envie sua resposta em texto.\n\n' + session.lastReply };
  if (command === 'cancelar' && session.menuId) {
    return reply('cancel', 'Deseja descartar o pedido atual?', ['Sim, cancelar', 'Não, voltar ao carrinho']);
  }

  switch (session.step) {
    case 'home':
      if (n === 1 || n === 2) return catalog();
      if (n === 3) return home(lastOrder ? `Pedido #${lastOrder.id} · ${lastOrder.status}\n\n${lastOrder.receipt}` : 'Ainda não há pedido registrado neste contato.');
      if (n === 4) return home(support ? `Fale com a equipe por aqui: https://wa.me/${support}` : 'O contato da equipe ainda não foi configurado.');
      break;
    case 'catalog': {
      if (n === items.length + 1) return session.cart.length ? basket() : catalog('Seu carrinho está vazio.\n\n');
      if (n === items.length + 2) return reply('home', greeting, homeOptions);
      const choices = n ? [n] : findDishOptions(input, items);
      if (choices.length > 1) {
        const matchingItems = choices.map(number => `${number} - ${items[number - 1].name}`).join('\n');
        return { session, body: `Encontrei mais de um item com esse nome. Qual você quer? Responda com o número ou o nome completo.\n\n${matchingItems}` };
      }
      const item = items[choices[0] - 1];
      if (!item) return catalog('Não encontrei esse item no cardápio de hoje. Confira as opções.\n\n');
      session.selected = item;
      return reply('quantity', `${item.name}. Quantas unidades? Responda com um número de 1 a 20.`);
    }
    case 'quantity': {
      const item = session.cart.find(entry => entry.name === session.selected.name);
      if (n < 1 || n > 20) return invalid();
      if ((item?.qty ?? 0) + n > 20) return { session, body: 'O limite é de 20 unidades por item. Digite uma quantidade menor ou MENU.' };
      if (item) item.qty += n;
      else session.cart.push({ ...session.selected, qty: n });
      return basket();
    }
    case 'basket':
      if (n === 1) return catalog();
      if (n === 2) return delivery();
      if (n === 3) return reply('remove', 'Qual item deseja remover?', [...session.cart.map(item => `${item.qty}× ${item.name}`), 'Voltar']);
      if (n === 4) return reply('cancel', 'Deseja descartar o pedido atual?', ['Sim, cancelar', 'Não, voltar ao carrinho']);
      break;
    case 'remove':
      if (n === session.cart.length + 1) return basket();
      if (session.cart[n - 1]) {
        session.cart.splice(n - 1, 1);
        return basket();
      }
      break;
    case 'cancel':
      if (n === 1) return home('Pedido descartado. Como podemos ajudar?');
      if (n === 2) return basket();
      break;
    case 'delivery':
      if (n === 1 || n === 2) {
        session.delivery = n === 1;
        return reply('name', 'Qual é o seu nome?');
      }
      break;
    case 'name':
      if (input.length < 2) return invalid();
      session.name = input;
      return session.delivery ? reply('address', 'Digite o endereço de entrega com rua, número e bairro.') : reply('note', 'Alguma observação? Se não houver, digite “sem observações”.');
    case 'address':
      if (input.length < 10 || !/\d/.test(input)) return invalid();
      session.address = input;
      return reply('note', 'Alguma observação? Se não houver, digite “sem observações”.');
    case 'note':
      session.note = input;
      return reply('payment', 'Como deseja pagar?', paymentOptions);
    case 'payment':
      if (paymentOptions[n - 1]) {
        session.payment = paymentOptions[n - 1];
        session.change = 0;
        return n === 3 ? reply('change', `Total: ${money(total())}. Digite o valor em dinheiro (ex.: 50,00) ou “sem troco”.`) : review();
      }
      break;
    case 'change':
      if (command === 'sem troco') return review();
      if (/^\d{1,6}([.,]\d{1,2})?$/.test(input)) {
        const cents = Math.round(Number(input.replace(',', '.')) * 100);
        if (cents >= total()) {
          session.change = cents;
          return review();
        }
      }
      break;
    case 'review':
      if (n === 1) {
        if (fromVoice) return { session, body: `Para enviar o pedido, digite 1 depois de conferir os dados.\n\n${session.lastReply}` };
        order = session.receipt;
        return home('Pedido enviado! ✅\nA equipe vai avaliar seu pedido. Consulte o andamento pela opção 3.');
      }
      if (n === 2) return basket();
      if (n === 3) return delivery();
      if (n === 4) return reply('cancel', 'Deseja descartar o pedido atual?', ['Sim, cancelar', 'Não, voltar ao carrinho']);
      break;
  }
  return invalid();
}
