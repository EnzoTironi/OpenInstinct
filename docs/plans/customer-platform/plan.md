# Zoen — plano de implementação e qualificação

Data: 14 de setembro de 2026. Status: plano apoiado em inspeção do código e documentação oficial; os testes novos abaixo ainda não foram executados.

## Resultado esperado

Uma pessoa entra com Google, conecta seus mensageiros à mesma identidade, participa de várias empresas e alterna de espaço sem misturar dados. Ela consegue criar skills e ferramentas, conversar com o Zoen de outra pessoa dentro de redes de confiança e delegar credenciais específicas ao seu agente. Cada empresa constitui uma rede de confiança. O produto continua usando a interface visual existente, Executor para ferramentas e Eve para execução.

Este documento permite entregar a implementação a outro agente sem repetir a descoberta. A matriz `acceptance.csv`, nesta pasta, transforma as jornadas em critérios de aceite. Nenhum item novo dessa matriz deve ser contado como aprovado apenas por este planejamento.

## Base examinada

- Repositório: [EnzoTironi/tryzoen](https://github.com/EnzoTironi/tryzoen).
- Produção qualificada anteriormente: `29086d3022c57eb0cd1ccc158b28f07ecf1f7ab5`, incorporando a [PR 98](https://github.com/EnzoTironi/tryzoen/pull/98).
- O código foi inspecionado na revisão indicada. Revalidar o estado de `main` antes de implementar.
- Evidência anterior: [relatório de lançamento](../../decisions/zoen-launch-validation.md).
- [CI](https://github.com/EnzoTironi/tryzoen/actions/runs/34887652196), [evals nativos](https://github.com/EnzoTironi/tryzoen/actions/runs/34887694700) e [deploy Alchemy](https://github.com/EnzoTironi/tryzoen/actions/runs/34889015447) aprovados nessa revisão. Os 15 resultados de eval são cinco cenários repetidos três vezes, não 15 jornadas diferentes nem um teste de capacidade.
- Há provas anteriores de login do piloto existente, mensagens WhatsApp e respostas em um grupo Telegram real. Elas não comprovam um cadastro Google novo, dois bots pessoais conversando, Vaultwarden ou uma ponte WhatsApp de usuário.

O executor da implementação deve atualizar as referências remotas, comparar o checkout com o `main` atual e preservar trabalho concorrente. Não assumir que este SHA continuará sendo o último.

## Os cinco pontos anteriores

| Ponto solicitado                           | Situação encontrada                                                 | Entrega que encerra a pendência                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Novo cadastro e conexão dos mensageiros | Login real de usuário existente; novas jornadas têm provas isoladas | Google real novo, Telegram e WhatsApp confirmados, uma identidade e retorno ao navegador correto |
| 2. Contas duplicadas                       | O primeiro contato nativo ainda pode criar outro usuário            | Impedir duplicidade na origem; reparar apenas os dados já separados                              |
| 3. Empresas e conexões                     | Há serviços de espaços, participação e permissões                   | Exercitar duas empresas, convidados, remoção e revogação Google de ponta a ponta                 |
| 4. Ferramentas, mídia e confiabilidade     | Catálogo existente e suite parcial                                  | Inventário completo, criação/publicação de ferramentas, evals ampliados, falhas e carga          |
| 5. Exclusão completa                       | A rota atual apaga memória e invalida sessões                       | Apagar o conjunto de dados pessoais, revogar acessos e impedir ressurgimento após restauração    |

Beeper, Matrix/A2A e Vaultwarden acrescentam trabalho a esses cinco pontos; não estão implicitamente aprovados pela CI anterior.

## Decisões de produto e segurança

### Identidade: nenhuma consolidação no onboarding normal

A expressão anterior “contas antigas” foi imprecisa. Em `server/accounts/index.ts`, `resolveVerifiedSender` chama `provision` sem usuário de destino. Quando não encontra uma identidade nativa, `provision` pode criar `public.user` e um espaço pessoal. O login Google posterior pode criar outra identidade Zoen. O conflito de vínculo evita uma união indevida, mas não evita a duplicidade inicial.

Fluxo proposto: Google cria a identidade canônica; o primeiro contato de um mensageiro desconhecido gera um registro temporário de entrada e um desafio de vínculo, sem criar usuário ou espaço definitivo. Ao confirmar, a identidade nativa passa a pertencer ao usuário autenticado. Mensageiros já vinculados podem oferecer o login posterior de um clique solicitado pelo usuário.

Uma pessoa pode ter múltiplas identidades Google verificadas e vários números, mantendo um único usuário Zoen e participações em várias empresas. Um endereço nativo confirmado não pode pertencer simultaneamente a duas pessoas. Não unir usuários por nome, e-mail parecido ou número informado sem prova. Normalizar telefone e tratar mudanças de identificador do provedor sem confundir IDs de remetente com números.

O `@username` identifica a pessoa; seu bot pessoal fica associado a ela por ID estável. A interface pode oferecer “Conversar com o Zoen de Ana”. Bots profissionais pertencem a espaços/empresas, têm identidade própria e não mudam de dono quando um funcionário sai. A busca distingue pessoa e bot, respeita a opção de aparecer publicamente e nunca concede acesso apenas porque encontrou um nome.

### Responsabilidades

| Componente                                  | Responsabilidade                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Better Auth + PostgreSQL                    | Usuário, sessões, identidades, empresas, redes de confiança, vínculos, concessões e estado de execução |
| Repositório versionado do Executor          | Conhecimento, instruções, skills, definições de ferramentas, versões e histórico autorizado            |
| Executor                                    | Descoberta, schemas, validação, autorização atual e execução de ferramentas                            |
| Eve                                         | Conversas, uso de codemode, tarefas duráveis e evals; manter um único ciclo de execução                |
| Matrix                                      | Salas, participantes e entrega de eventos humanos/bots                                                 |
| A2A                                         | Pedidos e resultados entre agentes, com autorização independente do identificador da conversa          |
| Vaultwarden + serviço de uso de credenciais | Cofre do cliente e uso delegado de itens específicos                                                   |
| Beeper/mautrix                              | Integração de mensageiros de usuário, separada dos canais de bot existentes                            |
| Mem0 e índices                              | Projeções de memória com escopo e exclusão; não substituem a autorização no banco                      |

Git não armazena senhas, sementes TOTP, sessões, tokens de mensageiro nem chaves de desbloqueio. Histórico Git também está sujeito a acesso e exclusão. Publicar uma skill não dá a ela permissões novas.

## Ordem de execução

1. P01: identidade e novo onboarding; P02: limites de empresas e grupos.
2. P03: ciclo completo de skills e ferramentas, apoiado nesses limites.
3. P04: dois bots via Matrix/A2A; P05: Vaultwarden; P06: Beeper/mautrix. São frentes separáveis após estabilizar os contratos de identidade e execução.
4. P07: exclusão completa incluindo os novos provedores; implementar seus contratos de revogação já durante P04–P06.
5. P08: qualificação integrada, observabilidade e capacidade; P09: documentação e publicação da revisão exata validada.

Entregar PRs por comportamento completo. Não iniciar uma migração ampla do runtime nem substituir a interface aprovada. Operon, cobrança, iMessage e gravação continuam fora deste trabalho. Vaultwarden e mensageria de usuário só podem aparecer como disponíveis depois de suas provas reais.

## P01 — identidade única e onboarding

**Reusar:** `server/accounts/index.ts`, `device.ts`, `archives.ts`, `archive-transfer.ts`, `controls.ts`; `web/auth/channel/`; serviços Better Auth existentes. Testes: `google-signin`, `device-login`, `device-link`, `channel-accounts`, `beta-admission`, `whatsapp-auth`, em `tests/runtime/`.

**Implementar:** separar remetente ainda não cadastrado de usuário permanente. Desafio deve vincular navegador de origem, usuário autenticado, provedor, remetente e finalidade — login ou vínculo. Guardar prazo, uso único e recibo idempotente. O conhecimento do telefone ou de um link não basta para trocar o dono. Revalidar sessão e identidade na confirmação; callbacks assinados não podem alterar o usuário de destino.

Usar transação e unicidade para confirmações concorrentes. Grupo desconhecido não pode provisionar silenciosamente contas pessoais de todos os participantes. Mensagem de grupo não confirma vínculo privado. Manter erro recuperável para link expirado, aparelho sem app, callback repetido, conta já vinculada e perda de sessão; os links precisam preservar o desafio.

Reparar o piloto separado mediante inventário, exportação e simulação da transferência. Preservar histórico, atribuição e conflitos; reemitir ou revogar concessões cuja autoridade mudou. Não transferir automaticamente credenciais, organizações ou permissões. Um reset de banco não corrige o algoritmo e não é requisito deste plano.

**Aceite real:** um piloto autorizado cujo Google nunca tenha entrado no Zoen percorre o carrossel, confirma Telegram e WhatsApp, sai e entra novamente. Conferir no banco uma identidade canônica, um espaço pessoal e vínculos corretos. Uma segunda pessoa não consegue assumir os vínculos. Contas de teste criadas diretamente no banco cobrem integração, não comprovam OAuth real.

**Interface:** preservar o céu, assets atuais, poucos textos, PT-BR/EN/ES e sheets de cerca de 80%, apenas fechar. Sem reload de documento nas transições internas. O usuário não vê “mesclar contas” no caminho normal.

## P02 — pessoal, empresas e grupos

**Reusar:** `server/workspaces/access.ts`, `session.ts`, `team.ts`, `connections.ts`, `repository.ts`; `server/google-workspace/`; `web/trpc/workspace-procedure.ts`. Testes `workspace-team`, `account-scope`, `team-connections` e `google-membership` existentes.

Preparar Ana e Bruno com espaços pessoais, duas empresas e um convidado externo. A seleção visual de espaço deve resolver para uma participação autorizada no servidor. Parâmetros de URL, campos enviados pelo modelo ou IDs copiados não conferem acesso. Convites têm expiração, destinatário/prova e proteção contra repetição.

Conectar Google pessoal, conceder explicitamente o uso necessário à empresa e revogar durante uma tarefa. Remoção de membro invalida sessão de trabalho, concessão, indexação, tarefa pendente e reuso de resultados privados. Google de empresa não migra para o pessoal na saída de funcionário. Um participante não pode autorizar ações com o Google ou cofre do dono do grupo.

Hoje `requireWorkspaceAccess(..., manage=true)` rejeita contextos de grupo e agentes externos; manter essa proteção. Criação a partir do grupo produz uma proposta vinculada ao espaço e ao autor. Um administrador autenticado publica pela interface; não relaxar a regra para qualquer mensagem de grupo.

**Aceite:** pessoal ↔ empresa A ↔ empresa B preserva estado de UI sem compartilhar conteúdo; usuário removido perde acesso em HTTP, Executor, A2A, buscas, revisões antigas, resumos e tarefas retomadas. Grupos só acessam o espaço explicitamente vinculado. Um convidado tem acesso estritamente ao que lhe foi concedido.

## P03 — criar, descobrir e usar skills e ferramentas

**O que existe:** `server/executor/skills.ts` carrega Markdown autorizado do Git; `server/workspaces/repository.ts` permite escrita controlada, exige permissão de gestão para skills/instruções e controla revisão. O catálogo executável é importado estaticamente. `WorkspacePathSchema`, em `server/workspaces/git.ts`, aceita `knowledge/`, `skills/`, `agent/` e dois manifests específicos. Não existe ali um cadastro geral de código de ferramentas de clientes. `workspace-save` não pode editar skills ou permissões.

**Reusar:** catálogo, definição, schemas, discovery, search, dispatch e runtime de `server/executor/`; repositório, capacidades e acesso de `server/workspaces/`. Não criar outro catálogo paralelo dentro do Eve. Testes base: `executor-codemode`, `workspace-repository`, `workspace-agents`.

**Novos contratos necessários:** definição versionada de ferramenta; publicação por espaço; revisão executável imutável; referência opaca de conexão; validação de capabilities. Derivar schemas/tipos uma vez, seguindo Effect 4 do repo. Antes de decidir diretórios ou formatos novos, confrontar as extensões com os schemas existentes. Os contratos desta seção são propostos, não APIs já implementadas.

Fluxo único: criar rascunho → validar schema e dependências → testar em ambiente isolado → publicar com permissão → descobrir pelo Executor → consultar schema → executar por codemode → observar resultado → desabilitar ou voltar à revisão anterior. Uma revisão de código, manifesto e dependências forma uma unidade de publicação.

Cobrir dois tipos: integração MCP/OpenAPI com servidor autorizado; e ferramenta criada pelo cliente com código limitado. Validar endereço, resolução DNS, redirecionamentos, rede privada/metadata, tamanho, timeout e saída. Ferramentas de cliente não podem herdar `process.env`, disco ou autoridade do processo da aplicação. A documentação instalada do Eve informa que ferramentas locais autoradas executam no runtime da aplicação; portanto não carregar código de cliente diretamente como `agent/tools/*.ts`.

O sandbox existente deve receber apenas capacidades mediadas pelo Executor, sem chave do serviço de credenciais nem rede irrestrita. Se ele não cumprir os limites de CPU, memória, rede, filesystem, concorrência e cancelamento, essa modalidade permanece indisponível até implementar o isolamento. Não executar o código no host como fallback. Conectores remotos também precisam de política de chamadas; uma descrição dizendo “somente leitura” não torna uma operação segura.

Skills referenciam ferramentas por identidade e versão; nome ou documentação não altera a autorização. Dependência ausente produz instrução acionável, não uma chamada inventada. Descoberta considera usuário, espaço, concessão e revisão; invocação revalida tudo mesmo com catálogo em cache. Configuração, publicação e uso ficam auditáveis sem material secreto.

**Três provas completas:** pessoal: dono cria “Organizar minha caixa”; profissional: membro propõe e administrador publica “Preparar reunião”; grupo: participante propõe “Resumo deste grupo” e administrador confirma no espaço vinculado. Cada uma cria uma ferramenta real de fixture, uma skill que a usa, uma nova revisão e um rollback. Testar leitura, escrita autorizada, erro, duplicação, revogação, tentativas entre espaços e instruções maliciosas. A ferramenta fixture modifica um recurso de teste observável, não apenas retorna uma frase de sucesso.

## P04 — conversar com o bot de outra pessoa via Matrix e A2A

### Redes de confiança

Decisão acrescentada pelo usuário: a comunicação entre agentes deve acontecer por uma rede de pessoas confiáveis, e uma empresa é uma dessas redes. Isto é uma especificação para Zoen; não uma afirmação de que a implementação interna do Instinct foi inspecionada.

Na empresa, derivar a participação da organização existente, sem criar uma segunda lista independente que possa ficar desatualizada. Uma participação ativa permite descobrir e contatar bots publicados para aquela rede, dentro da política da empresa, sem uma confirmação humana para cada mensagem. Um convite ainda não aceito não confere confiança. Convidados externos recebem uma concessão limitada; não ganham automaticamente a condição de funcionário.

No pessoal, usar convite e aceitação explícitos entre pessoas, com revogação e bloqueio. Não importar todos os contatos do telefone como pessoas confiáveis. Confiança não é transitiva: conhecer Ana não dá acesso aos contatos ou empresas de Ana. Participar de duas empresas não une suas redes.

Separar três decisões: quem pode descobrir o bot; quem pode iniciar uma conversa; quais informações e ações ele pode oferecer àquela audiência. O bot pessoal não é publicado automaticamente à empresa. Publicar um bot profissional à rede não abre todos os documentos da organização. Dados pessoais, credenciais e ferramentas privadas continuam fora da resposta, mesmo entre colegas confiáveis.

Cada pedido A2A deve carregar um contexto resolvido e autenticado pelo servidor: solicitante, bot de origem, bot de destino, rede, espaço, concessão e audiência. Não confiar em um campo de rede enviado pelo modelo nem no texto da Agent Card. A autenticação entre serviços identifica o agente; a concessão vinculada ao usuário e à rede limita o que ele pode fazer. Credenciais de serviço não substituem essa delegação.

Revalidar participação, política e bloqueios no começo, em cada uso de ferramenta e antes de entregar o resultado. A saída da empresa revoga acesso pela rede, inclusive tarefas na fila e concessões antigas. Bloqueio de uma pessoa prevalece sobre convites pessoais anteriores; regras de empresa continuam administradas no escopo profissional. Históricos e resumos mantêm sua audiência original, sem serem copiados automaticamente para uma nova rede.

Na interface, apresentar “Minha rede” e a rede da empresa dentro de Conexões, com pessoa, bot disponível e ação de conversar. Convite, aceite e remoção usam as sheets existentes. O contexto pessoal/profissional fica visível durante uma conversa com outro bot.

### Transporte e execução

**O que existe:** salas Matrix privadas de organização, mapeamento de membros, menção ao Zoen, deduplicação e revogação; perfis de bots e concessões A2A. `server/matrix/rooms.ts` exige organização e usa um bot Matrix global. `server/matrix/inbound.ts` verifica participação organizacional. As concessões externas atuais, em `server/workspaces/bots.ts`, são de arquivos/ontologia. Isso não equivale a uma conversa pronta entre dois bots pessoais.

**Reusar:** `server/matrix/{rooms,inbound,authority,delivery,client}.ts`, `server/workspaces/bots.ts`, `server/a2a/`; testes `matrix-rooms` e `workspace-agents`.

Criar duas identidades humanas e dois bots distintos no mesmo Synapse. Ana encontra o bot de Bruno disponibilizado para sua rede. A conexão pessoal aceita ou a política da empresa autoriza a conversa, com informação/ação compartilhável definida. Ana fala com o bot de Bruno sem virar membro do espaço pessoal inteiro dele. O sistema identifica explicitamente quem fala, qual bot responde, em qual rede e para qual audiência.

A nova concessão de conversa não deve ampliar implicitamente os grants atuais de leitura. Vincular sala, participante, bot de destino, espaço, validade e revisão de participação. Decidir identidade Matrix por bot ou vínculo de destino equivalente que o cliente não consiga falsificar; a identidade global atual não basta para atribuir vários bots.

Fazer duas jornadas separadas: humano Ana → bot Bruno; bot Ana → bot Bruno por A2A, com o resultado na conversa Matrix. Cada pedido tem uma única entrada executável: não disparar o mesmo trabalho pelo evento Matrix e pelo A2A. Reusar idempotência, cancelamento e tarefas terminais. Colocar limite de rodadas, orçamento, expiração e correlação para impedir bots respondendo indefinidamente um ao outro.

Autorizar cada operação e cada resultado com a identidade e concessão atuais. Um `contextId` conhecido não é autorização, conforme a [especificação A2A](https://a2a-protocol.org/latest/specification/#131-data-access-and-authorization-scoping). O membro removido perde acesso futuro; conteúdo já recebido não pode ser prometido como apagado do aparelho dele. Configurar e testar explicitamente a visibilidade histórica da sala, conforme [Matrix](https://spec.matrix.org/latest/client-server-api/#room-history-visibility).

**Aceite:** dois usuários independentes, Synapse real, dois agentes Eve reais e tarefas A2A reais; capturar eventos de entrada/saída e recibos. Segredos-canário privados de Ana, Bruno e empresas não aparecem na resposta. Repetir evento, cancelar tarefa, remover participante durante execução e tentar consultar contexto alheio. Teste atual de sala com receptor de mensagens de fixture não substitui esse aceite.

Primeiro contrato: pessoas diferentes dentro do mesmo serviço Zoen. Federação entre homeservers é outra qualificação e não pode ser anunciada por consequência. O caminho Matrix examinado lida com `m.text`; suporte criptográfico para salas E2EE deve ser implementado e testado antes de anunciar esse recurso. Credenciais jamais transitam nas mensagens, criptografadas ou não.

## P05 — Vaultwarden como cofre oferecido ao cliente

**Avaliação:** candidato viável para hospedar o cofre. É um servidor compatível com clientes Bitwarden, mantido independentemente, com licença AGPL-3.0, organizações/coleções e autenticação de dois fatores. Esses recursos são do upstream, não provas de integração Zoen. Preservar licenças, avisos e origem das modificações. [Vaultwarden](https://github.com/dani-garcia/vaultwarden).

**Distinção essencial:** autenticar no Zoen, desbloquear o cofre e autorizar o agente são operações diferentes. O banco do Vaultwarden não entrega senhas em claro ao agente. Uma chave de API também não basta: a CLI documenta desbloqueio adicional e uma chave de sessão para acesso aos itens; ela oferece leitura de TOTP. Não expor essa CLI ao modelo. [Bitwarden CLI](https://bitwarden.com/help/cli/).

**Reusar:** `db/services/vault.ts`, `server/executor/browser/{list_vault,fill_from_vault}.ts`, `agent/subagents/browser-agent/lib/autofill/`. O autofill atual valida sessão e origem e usa claims, mas ainda não prova Vaultwarden ou TOTP. Manter esse caminho privilegiado para preenchimento; não introduzir `get_password` ou `get_totp` que retorne valores ao modelo.

**Primeira entrega obrigatória: provar a delegação criptográfica.** Usar um cofre/coleção destinado ao agente e uma identidade criptográfica delegada que só consiga descriptografar os itens selecionados. Verificar em um protótipo real se a combinação Vaultwarden/cliente escolhida atende essa separação; não assumir que uma ACL de metadados cria uma chave por item. Caso não atenda, escolher e implementar separação por cofre/identidade em vez de reutilizar a senha-mestra do usuário. Registrar quais chaves ficam em quais processos e como são revogadas.

Para uso contínuo hospedado, apenas os itens delegados ficam utilizáveis pela infraestrutura de execução confiável do Zoen; não anunciar zero conhecimento sobre esses itens. Um conector local desbloqueado pelo usuário pode ser opção posterior, mas não é pré-requisito para o serviço hospedado solicitado. Não persistir um `BW_SESSION` global ou compartilhar uma identidade de cofre entre clientes.

O serviço de credenciais recebe referência opaca, origem, tarefa, usuário/espaço, operação e prazo. Revalida a concessão e entrega o segredo somente ao componente de preenchimento. Senhas e códigos não entram em chat, prompt, Git, Mem0, traces, replay, HAR, ferramentas de DOM, screenshots ou logs. Testar também vazamento após preencher: ocultar o campo visualmente não impede uma ferramenta de ler seu valor no DOM. Proteger a fase de entrada e as sessões/cookies resultantes; uma skill não pode extrair o segredo por script ou redirecionamento.

Separar 2FA de desbloqueio do cofre de TOTP usado para login em outro site. Delegar senha e TOTP ao mesmo agente automatiza ambos os fatores; isso não representa uma aprovação humana independente. Ações que precisem dessa aprovação continuam passando pela política do Executor. SMS, notificações push e WebAuthn exigem contratos próprios e não entram na promessa inicial de TOTP.

**Infraestrutura:** declarar serviço, versão/imagem fixa, rede, TLS, armazenamento, health checks e configuração no Alchemy existente. Usar PostgreSQL próprio com banco/role restritos, volumes e backup criptografado compatível com os anexos/configuração/chaves necessários à recuperação. Não misturar tabelas do vault com acesso irrestrito do runtime. Testar atualização, restauração isolada, rotação e indisponibilidade. Cadastro do cofre acompanha a beta fechada; não abrir inscrição pública por acidente.

**Aceite real:** Vaultwarden real, cliente compatível real e site de teste controlado com senha e TOTP. Criar cofre, desbloquear, armazenar dois itens e delegar só um. O agente entra no site autorizado sem ver senha/código; o segundo item e outro cliente permanecem inacessíveis. Testar código expirado, zeros iniciais, desvio de relógio, política de reuso do site, redirect de origem, iframe indevido, concessão revogada, queda/reinício e sessão antiga. Não usar contas financeiras ou alterar 2FA pessoal para provar o recurso.

Revogar impede novos usos e reuso de sessões dentro do Zoen; logout/revogação de sessões no site de destino depende do provedor e precisa de prova específica. Concessão de empresa não pode ser usada em conversa pessoal ou por outro bot. Coletar canários sintéticos para provar ausência de vazamento em todos os canais de observabilidade.

## P06 — Beeper e mensageiros em nome do usuário

**Escolha recomendada:** priorizar Synapse próprio com pontes mautrix para oferecer a experiência de mensageria pessoal hospedada descrita em [Beeper e referência Pally](beeper-pally.md). Beeper Desktop fica como conexão opcional para quem já o usa. A API Desktop é local e requer o aplicativo em execução. Ela oferece autorização OAuth com PKCE para conectar aplicações. [Desktop API](https://developers.beeper.com/desktop-api/), [autenticação](https://developers.beeper.com/desktop-api/auth/).

O `beeper/bridge-manager` conecta pontes ao homeserver do Beeper e declara que não funciona com Synapse próprio. Não confundir isso com hospedar toda a plataforma Beeper. Para a infraestrutura Zoen, começar pela documentação da ponte, com suas próprias sessões de usuário. [Bridge Manager](https://github.com/beeper/bridge-manager), [mautrix-whatsapp](https://docs.mau.fi/bridges/go/whatsapp/).

O registry do Eve retornou `channel/chat-sdk-beeper`, implementação `chat-sdk`, com referência `/integrations/chat-sdk-beeper#configure`. Examinar a definição e dependências antes de criar um adaptador. A descoberta no registry não valida acesso ao Desktop, isolamento por cliente, envio em nome do usuário ou compatibilidade com nosso Synapse. As buscas de Vaultwarden retornaram skills de terceiros, que não foram instaladas nem auditadas. Nenhuma dessas referências deve ser ativada com permissões do host automaticamente.

**Implementar:** conectar, mostrar conta e redes disponíveis, escolher chats permitidos, pausar/revogar, exibir indisponibilidade e retornar recibos. Pareamento do mensageiro como usuário é uma autorização diferente do vínculo de telefone para entrar no Zoen. Nunca reaproveitar silenciosamente a sessão de um cliente nem o token do bot como sessão de usuário. O Executor medeia pesquisa, leitura e envio; conta conectada não significa permissão de enviar para todo contato.

Para pontes, usar associação explícita entre usuário Zoen, conta Matrix, login remoto e grupo. O padrão de representação da própria conta Matrix é descrito em [double puppeting](https://docs.mau.fi/bridges/general/double-puppeting.html); credenciais amplas de appservice devem ficar isoladas do runtime e dos modelos. Verificar atribuição real, permissões e chaves de criptografia, em vez de apenas aceitar o nome do remetente na UI.

**Aceite inicial hospedado:** conta WhatsApp piloto autorizada e grupo existente só com participantes de teste. Conectar pela ponte, receber mensagem, responder como a conta conectada e comprovar destinatário, grupo e autor. Testar DM, texto, imagem, áudio, resposta citada, reconexão, desconexão, mensagem duplicada e tentativa de ler outro cliente. Extender a outras redes uma de cada vez com a mesma matriz; não anunciar “todos os sociais” a partir do WhatsApp.

Tratar confirmação de envio incerta sem retry cego. Impedir espelhamento circular e duas respostas quando a mensagem chega pela ponte e por um canal de bot. Sair do grupo ou revogar o login deve cancelar trabalhos dependentes. Validar o suporte real de criptografia da ponte e as responsabilidades de armazenamento; o processo que converte mensagens é parte da fronteira de confiança.

O caminho Kapso/Telegram de bot permanece preservado. A ponte é uma nova modalidade de conexão, não um bypass das limitações da Cloud API nem uma garantia de disponibilidade do provedor.

## P07 — exclusão completa e revogação

**Base:** `server/accounts/privacy.ts`, `server/memory/erasure.ts`, `shared/identity/account-privacy-limits.ts`, `db/services/organization-erasure.ts`. A descrição atual de exclusão da conta limita o efeito à memória e às sessões; não tratar como apagamento completo.

Criar um processo durável idempotente: suspender a conta → revogar identidades/sessões/grants/conexões → cancelar jobs → apagar os dados sob controle do Zoen → registrar conclusão ou pendências verificáveis. Abranger conversas, anexos, fontes, bundles/revisões Git, LFS/object storage se usados, Mem0/índices, vault delegado, bridge sessions, Matrix e telemetria identificável, segundo política publicada.

Manter dados corporativos sob propriedade da empresa, com atribuição mínima conforme política; não apagar o espaço da empresa porque um membro excluiu sua conta. Um único dono precisa transferir propriedade ou encerrar a organização por fluxo explícito. Credenciais pessoais compartilhadas com empresa devem perder uso futuro; cópias já criadas precisam de tratamento definido.

Backups não podem ressuscitar usuários apagados. Definir retenção e guardar um registro mínimo de apagamentos fora do conjunto que será restaurado; reaplicar antes de liberar tráfego. Testar a restauração a partir de backup anterior à exclusão. A interface distingue exclusão ativa concluída de expiração futura dos backups e limita o que é possível apagar de cópias mantidas por terceiros ou destinatários Matrix.

## P08 — testes, evals e observabilidade

### Cobertura verificável

Gerar inventário a partir dos catálogos reais e publicações: ferramenta/skill, versão, origem, escopo, operação, provedor, teste positivo, negativa de acesso, erro, cancelamento, efeito observável e evidência. Toda ferramenta anunciada como disponível precisa de uma linha. Repetir a descoberta depois de criar uma ferramenta para provar que o cadastro é consumido, não só salvo.

Usar três níveis identificados: teste determinístico de contrato; integração com PostgreSQL/Synapse/Vaultwarden/sandbox reais; jornada real com usuário, modelo e provedor. Fixture não vale como prova de entrega real. Usar sites, caixas, documentos e grupos de teste autorizados, sem mensagens para contatos não participantes.

Expandir `evals/launch/` e reutilizar `evals/agent/` com `defineEval`, sessões HTTP reais, assertions de ferramenta e recibos. Cobrir criação/descoberta/uso/revogação, identidade e espaço incorreto, instrução maliciosa, outro bot, 2FA delegado, falha de provedor, mídia e interrupção. Segurança precisa de asserção determinística sobre dados e efeitos; resposta educada do modelo não comprova bloqueio. Novo loop ou avaliador paralelo ao Eve não é necessário.

Comparar Spark, se disponível por conexão Codex autorizada, com Luna de baixo esforço em conjunto fixo. Registrar modelo resolvido e fallback; não mudar silenciosamente de modelo para esconder falhas. A baseline anterior é Luna. Não copiar tokens pessoais para Git, imagens ou relatórios. Rodar ao menos três repetições por cenário funcional e divulgar cenários únicos separadamente de execuções totais.

### Capacidade inicial proposta, ainda não medida

Para a beta fechada, começar com 25 usuários ativos e cinco tarefas de agente concorrentes, com rajadas de dez. Executar 30 minutos de carga e depois 24 horas de uso de teste com ciclos de trabalho, pausa e reinício. A fila deve limitar trabalho quando o provedor não suportar a demanda; não aumentar custos automaticamente. Ajustar o envelope apenas com medição registrada.

Critérios iniciais: zero vazamento de escopo, zero efeito externo duplicado, zero mensagem aceita perdida sem estado recuperável, zero continuação após revogação. Para API interna simples, medir p95 abaixo de 1 s; para início de tarefas, p95 da fila abaixo de 10 s dentro do envelope. Separar fila, modelo, ferramenta e entrega; não cobrar um tempo fixo único para tarefas LLM diferentes. Registrar conclusão, timeout, cancelamento, custo e erro por cenário/provedor. Quota insuficiente significa capacidade não validada, não teste aprovado.

Injetar falhas de PostgreSQL, reinício de worker, Mem0 indisponível, bridge offline, timeout depois de envio, webhook duplicado, perda de confirmação e cancelamento durante browser/TOTP. Validar recuperação e limites, não somente o caminho feliz.

### Observabilidade útil sem registrar credenciais

Correlacionar solicitação, usuário/espaço, canal, sala, run, ferramenta/revisão, concessão, autorização, outbox e resultado. Incluir duração por etapa, filas, consumo do modelo, retries, conflitos, publicação/revogação e exclusão. A visualização enterprise só mostra seu escopo. Suporte usa acesso rastreado e limitado.

A coleta ampla da beta não inclui senhas, sementes/códigos TOTP, tokens OAuth, cookies, chaves de sessão ou campos preenchidos. Executar scanners de canários em traces, armazenamento, replays, screenshots, métricas e exportações. Testar o painel de observabilidade e pelo menos um alerta real provocado por falha controlada. Não adicionar uma etapa de coleta ao onboarding; refletir a política efetiva nos controles e documentos existentes.

## P09 — entrega, docs e release

Seguir `AGENTS.md`: Effect 4, schemas derivados, serviços existentes, browser no subagente declarado, ferramentas no Executor. Ler a documentação instalada de Eve/Next pertinente antes de alterar APIs. Reusar os componentes visuais e i18n existentes. Verificar compatibilidade por funcionalidade antes de adotar pacote do registry.

No repo, com Node 24 e dependências fixadas, executar os comandos existentes:

```sh
pnpm check
pnpm build
pnpm db:check
pnpm test:runtime
pnpm eval:list
pnpm eval:ci
```

Verificar a seleção efetiva dos cenários em `scripts/run-agent-evals.ts` e na workflow `zoen-agent-evals.yml`; `eval:ci` por si só não garante que arquivos novos foram incluídos. Preparar serviços reais e variáveis de teste antes dos testes runtime. Não rodar migrações destrutivas de teste sobre produção. Usar os comandos de infraestrutura e a workflow Alchemy já existentes; não usar o deploy genérico do Eve como substituto da infraestrutura do produto.

Atualizar README, mapa de capacidades, configuração de implantação, recuperação, limites dos provedores, fluxo de identidade, publicação de ferramentas e política de dados. Corrigir textos antigos sobre “consolidação futura” e status já resolvidos no ledger. Manter os avisos de licenças dos componentes incorporados. Investigar separadamente os dois jobs de atualização Dependabot que falharam; isso não invalida a CI de produto já aprovada, mas a manutenção automática deve funcionar.

Cada PR registra testes e limites do comportamento final. A publicação final deve apontar para o mesmo SHA testado, registrar imagens/digests, migrações, rollback compatível e saúde posterior. Primeiro disponibilizar aos pilotos; uma integração só é ativada quando a linha de aceite correspondente estiver comprovada.

## Evidências e definição de concluído

Para cada execução da matriz, salvar: ID do caso, SHA, configuração/versões, tipo de prova, ambiente, data, resultado, modelo quando aplicável, correlação, efeito esperado/observado e caminho da evidência sanitizada. Resultados possíveis: passou, falhou ou bloqueado com causa; não transformar exclusão de teste em aprovação.

Os cinco pontos originais só ficam concluídos com suas jornadas reais e negativas de acesso aprovadas. Matrix só fica concluído com duas pessoas e dois bots. Vaultwarden só fica concluído com custódia de chaves descrita, login com TOTP real e provas de não vazamento. Ferramentas só ficam concluídas com cadastro, uso e revogação nos três escopos. A ponte WhatsApp só fica concluída com grupo real autorizado, atribuição e recuperação verificadas.

Guardar evidências privadas fora do repo público. Publicar no repo apenas fixtures sintéticas, testes e relatórios sanitizados. Não alegar certificação externa, suporte universal a provedores ou capacidade de produção a partir de um smoke test. Encerrar com pendências explícitas por integração, sem esconder uma limitação atrás de “prod-ready”.
