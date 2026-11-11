# Restaurante da Família | bot na nuvem

Esta edição roda no **Cloudflare Workers Free**. O restaurante usa apenas o celular para abrir o painel e operar os pedidos. O SQLite do Durable Object guarda os dados, e o Workers AI transcreve os áudios. O bot continua usando a API oficial da Meta.

## Publicação inicial

1. Extraia o ZIP. Crie um repositório privado no GitHub ou GitLab e envie os arquivos extraídos para a raiz do repositório. Essa instalação é feita uma vez por quem administra o projeto. Depois disso, o celular do restaurante só precisa do endereço do painel.
2. Entre na conta do restaurante no [painel da Cloudflare](https://dash.cloudflare.com/) e mantenha **Workers Free**. Em **Workers & Pages**, crie um Worker importando o repositório. Use o nome `restaurante-familia-bot`, que já consta em `wrangler.toml`. Use a pasta raiz, deixe o comando de build vazio e use `npx --yes wrangler@4 deploy` como comando de deploy. Deixe os deploys de prévia desativados. O arquivo `wrangler.toml` cria o banco e o acesso ao Workers AI.
3. Abra as configurações do Worker e adicione as variáveis abaixo em **Variables and Secrets**. Use o tipo **Secret** para senhas e tokens. Guarde as chaves no painel da Cloudflare. O repositório contém apenas o código e a configuração pública.

| Nome | Valor |
| --- | --- |
| `ADMIN_PASSWORD` | Segredo. Senha forte de pelo menos 16 caracteres. O usuário é `dono`. |
| `META_APP_SECRET` | Segredo do aplicativo em Meta for Developers. |
| `META_VERIFY_TOKEN` | Segredo aleatório criado por você. Use o mesmo valor na configuração do webhook na Meta. |
| `META_ACCESS_TOKEN` | Segredo. Token da Meta com permissão `whatsapp_business_messaging`. Comece com o token do número de teste. |
| `META_PHONE_NUMBER_ID` | Identificador do número de teste da Meta. |
| `META_GRAPH_VERSION` | Versão da Graph API mostrada no exemplo da Meta, com prefixo `v`. |
| `SUPPORT_NUMBER` | Opcional. WhatsApp da equipe com código do país e DDD, só dígitos. |

As variáveis já declaradas em `wrangler.toml` ficam no repositório. `DELIVERY_FEE_CENTS` vem como `0`. Troque, por exemplo, para `500` se a entrega custar R$ 5,00. Ajuste `RESTAURANT_TIME_ZONE` para o fuso do restaurante. `VOICE_ENABLED = "0"` desabilita o áudio. Cada alteração no repositório exige um novo deploy.

## Conectar e testar o WhatsApp

1. No [Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), abra o produto WhatsApp e use o número de teste. Adicione seu próprio número à lista de destinatários de teste.
2. Abra o domínio `workers.dev` fornecido pela Cloudflare com `/health` no final. A resposta deve ser `OK`. Na Meta, configure a URL de callback com `/webhook`, use o valor de `META_VERIFY_TOKEN`, assine o campo `messages` e [inscreva o aplicativo na conta WhatsApp Business](https://www.postman.com/meta/whatsapp-business-platform/request/c1ai24q/subscribe-to-your-waba).
3. No celular, abra o mesmo domínio com `/admin`. Entre com `dono` e a senha. Publique um prato por linha, por exemplo `Feijoada completa | 28,00`.
4. Envie `Oi` para o número de teste no WhatsApp. Escolha fazer pedido e teste tanto o número quanto o nome do prato. Para voz, envie um áudio curto dizendo `quero uma feijoada`. Confira a transcrição. Para confirmar o pedido, revise e digite `1`. Atualize o painel para ver o pedido.
5. Depois do teste, cadastre o número exclusivo do restaurante na Meta, troque o identificador e o token no Worker e repita o fluxo. Confirme o consumo na Meta antes de divulgar o número. Um token temporário precisa ser substituído por um token adequado para operação contínua.

## Como manter a operação na faixa gratuita

- **Hospedagem e dados:** mantenha a conta em Workers Free. O endereço `workers.dev` dispensa a compra de um domínio. Se a conta atingir os limites gratuitos de execução ou banco, o bot pode parar de responder até liberar cota. Preserve o Worker e o Durable Object ao atualizar a aplicação para manter os pedidos e o histórico do limite.
- **Áudio:** no Workers Free, o [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) tem uma cota compartilhada de 10.000 neurons por dia. O recurso usa Whisper na Cloudflare, sem chave da OpenAI. Se a transcrição falhar ou a cota de IA acabar, o bot pede que o cliente responda por texto. Valide o formato do áudio real do WhatsApp no número de teste. As gravações são encaminhadas à Cloudflare para transcrição e o servidor aproveita apenas os dados em texto.
- **WhatsApp:** a [Meta](https://whatsappbusiness.com/resources/faq/) oferece 1.000 mensagens de atendimento gratuitas por número por mês. O bot pausa novos envios por padrão após 900 tentativas em 32 dias. O painel mostra o contador. A contagem local inclui tentativas repetidas e não é a contagem de entregas usada na fatura da Meta. Use o número exclusivamente neste bot, confira o consumo na Meta e mantenha o mesmo banco. Durante a pausa, novos pedidos não avançam. O número pode ter custo da operadora.

Referências da Cloudflare: [Conectar o repositório](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/) · [Guardar segredos](https://developers.cloudflare.com/workers/configuration/secrets/) · [Cotas de armazenamento](https://developers.cloudflare.com/durable-objects/platform/pricing/).
