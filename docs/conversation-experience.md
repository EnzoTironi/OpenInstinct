# A experiência de conversa que o Companion precisa alcançar

08/09/2026 · desenho de produto e plano de execução · não implementado por este documento.

**Você manda o que precisa, continua falando normalmente e pode confiar que o
Companion acompanha, resolve e volta com o resultado.**

O produto precisa reduzir o trabalho de explicar, supervisionar e corrigir um
assistente. WhatsApp e Telegram são a experiência principal. Uma página web entra
quando conexão, cadastro ou artefato precisa dela. A pessoa não precisa entender
ferramentas, sessões, modelos ou aprovações técnicas.

## Base da pesquisa e limites

Foram lidos trechos extensos da conversa privada com o Poke no Mensagens,
incluindo discussões de 25–27 e 31 de agosto e perguntas feitas em 8 de setembro
com autorização do usuário. Instinct e Flip foram comparações secundárias.
Leitura pela interface, não exportação integral nem auditoria das ferramentas
executadas pelos outros assistentes.

Preservamos padrões e situações, sem reproduzir histórico privado, contatos,
códigos, informações financeiras ou assuntos pessoais. Os exemplos de produto
são novos e ilustrativos. Nenhuma tarefa histórica deve ser reativada pela pesquisa.

Distinguimos comportamento observado, explicação do Poke e decisão de desenho.
Uma afirmação do Poke sobre arquitetura, política, preço ou velocidade não prova
como seu produto funciona. O código atual do Companion, inspecionado em 417feed,
fundamenta a implementação. A decisão final do usuário permite botões e cards
quando ajudam, mantendo a conversa como experiência principal. Isso substitui
a hipótese intermediária de proibir todos os botões.

## O que aprendemos

| Padrão observado                                                          | Experiência desejada                                                                   | Limite ou correção                                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| “E aí?” retoma trabalho pendente sem repetir briefing.                    | Saber o que ficou aberto, seu estado e o que falta entregar.                           | Com dois referentes plausíveis, esclarecer; não escolher sempre o mais recente.                                                |
| “Na verdade…” altera orientação durante execução.                         | Incorporar nova intenção antes da próxima ação material.                               | Interrupção não desfaz efeito já enviado.                                                                                      |
| “Deixa quieto, vamos voltar…” encerra um assunto e retoma outro.          | Distinguir abandonar pedido, pausar tarefa e mudar de assunto.                         | Mudança de assunto sozinha não cancela trabalho autorizado.                                                                    |
| Fragmentos, erros de digitação e complementos fazem parte do diálogo.     | Entender o conjunto sem exigir sintaxe correta nem três respostas ao mesmo pensamento. | Guardar todo fragmento aceito; retry do provedor não é novo pedido.                                                            |
| Reconhecimento curto antecede trabalho demorado.                          | Mostrar que entendeu e começou quando a espera ficaria estranha.                       | Nada de “olhando” obrigatório nem promessa sem trabalho aceito.                                                                |
| Resultados dizem o que mudou e oferecem destino inspecionável.            | Fechar a tarefa com resultado concreto e link quando útil.                             | Proposta, aceitação, conclusão e entrega são estados distintos.                                                                |
| A resposta cresce quando o usuário pede arquitetura ou análise.           | Ajustar profundidade ao assunto.                                                       | Uma linha ou uma bolha obrigatórias prejudicam tarefas complexas.                                                              |
| Informalidade e humor aparecem no diálogo.                                | Tom próximo, específico e confortável.                                                 | Minúsculas são a voz escolhida pelo usuário; não implicam eliminar pontuação, forçar palavrão, bajular ou inventar intimidade. |
| Proposta seguida de “sim” leva à ação sem comando técnico.                | Confirmar naturalmente o conteúdo apresentado.                                         | Consentimento pertence à ação e versão, não à palavra isolada.                                                                 |
| O usuário delega decisões rotineiras.                                     | Escolher execução dentro do pedido e das permissões.                                   | Delegação não autoriza mudar objetivo, destinatário, custo ou alcance.                                                         |
| Há ofertas repetidas depois de autorização para seguir.                   | Continuar sem reabrir a mesma decisão.                                                 | Antes de perguntar, verificar se a resposta já existe.                                                                         |
| Pedido de validação é seguido por anúncio de validação e implementação.   | Conservar verbo e alcance do pedido.                                                   | Iniciativa não transforma analisar em alterar.                                                                                 |
| O usuário pede consulta ao repositório em vez de especulação.             | Verificar a fonte disponível antes de afirmar.                                         | Fluência não substitui evidência.                                                                                              |
| Explicação de cota presume automações; o usuário diz que não tem nenhuma. | Explicar limites com consumo real da conta.                                            | Não inventar causa, preço, benefício ou desconto.                                                                              |
| Há pedidos recorrentes de status pelo usuário.                            | Retornar quando o trabalho termina ou precisa dele.                                    | Isso sugere atrito, mas não prova que todo pedido de status foi falha de monitoramento.                                        |
| Na consulta nova, Poke recomenda silêncio após encerramentos.             | Encerrar sem pergunta, oferta ou agradecimento em cascata.                             | “Ok” pode ser consentimento ou encerramento: contexto decide.                                                                  |
| Na mesma consulta, admite incerteza e oferece checar.                     | Verificar sozinho quando a leitura já estiver autorizada.                              | Pedir ajuda só quando acesso ou decisão faltarem.                                                                              |
| No Flip, país informado não muda a oferta inicial de integração.          | Aplicar restrições conhecidas antes de conectar ou prometer valor.                     | Informalidade sem atenção ainda produz onboarding ruim.                                                                        |
| Instinct contextualiza alertas, mas pesa em detalhes operacionais.        | Avisar a mudança que importa e a consequência prática.                                 | Mensageiro não deve virar fluxo de logs.                                                                                       |

As melhores referências são atenção, continuidade, iniciativa dentro do pedido
e linguagem proporcional. Fragmentação excessiva, certeza sem evidência e
perguntas rotineiras desnecessárias não fazem parte do alvo.

### Consulta específica sobre humanização

Em 8 de setembro, a consulta foi ampliada de cinco exemplos para 24 categorias,
com três situações hipotéticas por categoria e contrapontos, seguida de três
conversas completas sobre companhia, mudança de tom e recuperação de confiança.
Foram explorados
trabalho, cotidiano, emoções, relações e conversa casual. Esses exemplos foram
produzidos pelo Poke para a pesquisa; não são episódios comprovados de uso.

O material reforçou cinco escolhas: aliviar um esforço específico; reconhecer
erros sem discurso defensivo; permitir conversa sem tarefa; adaptar a resposta
ao feedback de tom; e encerrar sem transformar toda fala em nova oferta. Pediu-se
também variação de intensidade e contexto, porque os primeiros exemplos ficaram
concentrados em programação e respostas secas.

Os contrapontos foram essenciais. Alguns exemplos sugeriram acalmar a pessoa de
forma imperativa, prever o pensamento de terceiros, supor memória não apresentada
ou anunciar correção externa imediata. Ao ser confrontado, o Poke reconheceu
alguns excessos, mas voltou a eles em exemplos posteriores. Logo, autodescrição
e um bom exemplo isolado não bastam: precisamos avaliar consistência em vários
turnos e após feedback. O desenho aceita o princípio de proximidade e corrige
essas inferências e efeitos não sustentados.

Quando a pergunta enfatizou os limites, algumas respostas passaram a narrar
regras em vez de conversar. Isso também não é o alvo. Os controles pertencem à
execução; a pessoa recebe a pergunta ou informação concreta de que precisa.
Nas situações de emoção, evitar tanto a fala burocrática quanto a intimidade
performática. Não transformar sobriedade num veto a entusiasmo ou carinho.

A rodada final propôs escolher extensão pela intenção e pelo momento: rapidez
para uma resolução simples, pergunta que abre espaço ou remove dúvida real,
acolhimento mais desenvolvido quando ajuda a pessoa a se sentir ouvida e silêncio
quando ela encerra ou o pede. Adotamos isso como julgamento contextual, sem
associar automaticamente uma emoção a certo número de linhas. Na recuperação de
confiança, não transferir toda conferência de dados à pessoa nem abandonar a
iniciativa como substituto de verificar melhor; respeitar uma restrição explícita
de atuação se ela de fato a pedir.

O [catálogo autoral de casos](conversation-humanization-cases.md) traduz as
decisões em situações novas para revisão. Ele é distinto desta pesquisa e de
qualquer evidência futura do runtime. Falas naturais admitem alternativas;
fatos, autorizações, efeitos e respeito ao feedback precisam se manter corretos.

Por orientação explícita do usuário, o Poke continua sendo a referência
prioritária de experiência nos próximos incrementos. Dúvidas de comportamento
pedem exemplos contrastantes e conversas completas; dúvidas de funcionamento
pedem que ele diferencie observação, documentação e hipótese. Perguntas novas
devem resolver uma lacuna concreta do incremento, sem repetir coleta já feita
nem atrasar implementação por pesquisa aberta indefinidamente. Guardar a
conclusão de produto e sua confiança, sem exportar o histórico privado.

### Consulta sobre funcionamento interno

Na rodada seguinte, o Poke foi perguntado sobre seis mecanismos e separou sua
resposta em observação própria, explicação que considera documentada e hipótese.
Não foi fornecida documentação pública nem código auditável para confirmar a
implementação. Toda a coluna de relato abaixo permanece autodescrição do Poke;
as implicações são decisões propostas para o Companion, ancoradas nos donos
atuais mapeados mais adiante.

| Tema                           | Relato do Poke                                                                                                               | Implicação para o desenho                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Contexto                       | Diz receber contexto estruturado de perfil/conexões, resumo e mensagens recentes com canal e tempo.                          | Disponibilizar contexto pertinente, com origem e atualidade; resumo não substitui estado real ou mensagem autorizadora.                         |
| Memória                        | Diz delegar alterações duráveis e tratar correções recentes como superiores às antigas; invalidação de resumos é hipótese.   | Reusar o serviço de memória existente e provar esquecimento sobre derivados. Não criar agente secundário só para imitar a arquitetura relatada. |
| Nova mensagem durante trabalho | Diz receber a mensagem no turno seguinte e redirecionar trabalho pendente; mecanismo de fila/cancelamento é hipótese.        | Dar atenção imediata a stop/correção no caminho disponível, sem prometer recolher chamada externa já despachada. Provar as janelas de corrida.  |
| Ritmo e bolhas                 | Atribui a escolha de texto/controles ao modelo e a separação/entrega ao transporte. Diz que quebras podem virar bolhas.      | A fragmentação excessiva foi observada nesta pesquisa; qualificar o renderer e a outbox, não tentar resolver só com adjetivos no prompt.        |
| Aviso futuro                   | Relata registro de automações independente da conversa; persistência após restart é explicação hipotética da infraestrutura. | “Te aviso” exige registro real, destino, condição, orçamento e prova após restart no nosso runtime.                                             |
| Confirmação natural            | Relata rascunhos identificáveis e propõe vínculo da confirmação à versão apresentada; validação do backend é hipótese.       | Reusar pendências Eve e validar proposta/revisão/remetente, sem outro banco de autoridade e sem aceitar inferência do modelo como autorização.  |

O valor da consulta é localizar mecanismos necessários e exemplos de experiência,
não certificar o fornecedor nem importar sua organização interna. Correção recente
deve atualizar a intenção no próprio alcance; não revoga invariantes nem reescreve
efeitos já ocorridos. O desenho continua dependente de prova no Companion.

## Decisões de produto

WhatsApp não pode exigir nem oferecer comandos com barra (`/`) para qualquer
operação do agente, inclusive vinculação, aprovação, cancelamento e arquivos.
No Telegram, usar comandos somente quando a plataforma realmente exigir ou
quando forem indispensáveis; o fluxo normal continua sendo a conversa.

O agente conversacional é responsável por entender intenções, apresentar
propostas, decidir a decomposição do trabalho e redigir as respostas conforme o
contexto. Não codificar roteiros de fala por ferramenta, catálogo de frases de
aprovação ou outro intérprete paralelo ao agente. Exemplos do Poke orientam
avaliação e comportamento, não são templates do produto. O executor valida os
contratos estruturais de identidade, direitos, revisão, persistência e entrega.

### A primeira mensagem já é o onboarding

Pedido completo recebe ajuda. “Oi” recebe uma resposta humana curta que abre
espaço para conversar. Sem discurso de boas-vindas com catálogo, formulário ou
escolha de agente. Identidade verificada cria conta interna; controles de custo
e abuso começam na entrada.

Login adicional precisa de razão concreta: integração ou cadastro mínimo para
ampliar cota esgotada. Conectar agenda não pede email e contatos sem necessidade.
Sessão web já aberta no computador do desenvolvedor não prova a jornada de uma
pessoa nova no celular. Ver [contrato de onboarding](native-onboarding.md).

### Uma conversa contínua, vários assuntos possíveis

Cada turno combina mensagem atual, fragmentos recentes, referência de resposta,
pedidos abertos, decisões pendentes, resultados recentes e memória autorizada.
Uma conversa casual não apaga o pedido original. Status, correção e cancelamento
funcionam sem abrir uma página de tarefas.

Histórico, memória e estado da tarefa têm donos diferentes. Eve conserva turnos
e sessões. A aplicação conserva os fatos necessários sobre efeitos, propriedade,
entrega e referências ao trabalho. Memória conserva preferências e fatos
duráveis com origem e correção. Resumo não prova consentimento; perfil pessoal
não é fila de tarefas.

Entre canais vinculados, compartilhar memória permitida, mantendo conversas
distintas. “Cancela aquilo” no WhatsApp não cancela silenciosamente a última ação
do Telegram. Retomada entre canais exige referente claro e direitos atuais.
Privado e grupos fazem parte do escopo solicitado em 8 de setembro de 2026.
Isso substitui a exclusão anterior de grupos; cada canal ainda precisa de prova
real e dos requisitos operacionais do seu provedor.

### Conversa disponível enquanto os pedidos trabalham

A conversa orquestra múltiplos pedidos sem aguardar o término de trabalho longo.
Um pedido em execução não impede uma pergunta breve, outro pedido independente,
uma correção ou um cancelamento. Cada resultado volta ao pedido e à conversa que
o originaram. A conclusão retoma a conversa por evento durável; não por um loop
paralelo de polling do modelo.

O [Spacebot](https://github.com/spacedriveapp/spacebot/blob/main/docs/content/docs/%28core%29/architecture.mdx)
é referência para separar conversa, execução e retorno por eventos. Seu desenho
não autoriza trocar o runtime ou copiar toda a sua infraestrutura. Na instalação
atual, o guia de subagentes descreve espera pelo lote, mas o guia de ferramentas
e a implementação instalada expõem subagentes como Tasks em background quando
`experimental.tasks` está habilitado, como já ocorre neste projeto. Qualificar
esse caminho com uma execução real: recibo imediato, novo turno antes da
conclusão, cancelamento de apenas uma Task e recuperação após restart. Não
deduzir comportamento integrado de um único guia. Ferramentas duráveis com
`execution: "background"` também têm contrato público de retorno posterior.
A execução deve usar sessões e durabilidade públicas do Eve, com vínculos de produto para
pedido, proprietário, revisão e destino; não inventar outro motor de turnos.

Em consulta direta, o Poke descreveu quatro exemplos fictícios: pedidos
simultâneos, correção durante outro trabalho, pessoas diferentes num grupo e
aprovação por terceiro. Seus relatos reforçam a experiência pretendida, mas
não comprovam arquitetura interna, isolamento ou garantias de autorização.

No grupo, o identificador da conversa nunca substitui o identificador do ator.
Manter contexto compartilhado do grupo separado de memória, integrações e
histórico privados de cada participante. Recuperação privada não pode entrar no
contexto coletivo antes de verificar se o conteúdo pode ser compartilhado.
Uma resposta no grupo não autoriza ação na conta de outra pessoa. Referências
citadas, mensagens encaminhadas e nomes visíveis não conferem identidade.

Cada pedido conserva remetente verificado, conversa de origem, referência da
mensagem, sessão executora e destino permitido. O modelo escolhe o trabalho;
o executor deriva essas identidades do ingresso verificado. Um resultado privado
não muda para o grupo porque o solicitante fez uma pergunta ali. Correção e
cancelamento atingem somente o pedido identificado e permitido, preservando os
demais trabalhos.

Provas obrigatórias: dois trabalhos com conclusões fora de ordem; pergunta breve
respondida antes de um trabalho longo terminar; correção de um pedido sem parar
o outro; dois atores no mesmo grupo; tentativa de aprovação por terceiro;
conteúdo privado solicitado no grupo; remoção/revogação durante execução;
restart entre conclusão e entrega, sem duplicação. A aprovação natural precisa
funcionar também quando a proposta vem da sessão executora de um pedido.

### Anexos persistentes e recuperáveis

Requisito explícito de 8 de setembro: enviar e receber arquivos, imagens e
documentos; salvar anexos no workspace e recuperá-los por ID estável. O ID
interno conserva propriedade, origem, tipo, nome, conteúdo e versão, separados
do ID ou URL temporário do provedor. Receber uma mensagem com referência de
mídia não prova que o arquivo foi salvo ou compreendido.

O anexo precisa sobreviver à expiração da URL de origem e ao restart. Conversa
e Tasks recebem uma referência ao mesmo artefato permitido; não redownloads
independentes nem cópias sem vínculo. “Usa a planilha de ontem” pode recuperar a
referência pelo contexto e metadados autorizados; se houver mais de uma candidata
plausível, esclarecer qual antes de usar. Um novo arquivo com o mesmo nome não
substitui silenciosamente o conteúdo anterior.

Download, persistência, extração/leitura e envio têm resultados distintos.
Provar o envio nativo com recibo do provedor e integridade do arquivo; uma URL
de Blob, caminho interno ou legenda não comprova entrega. URLs privadas não
entram em mensagens públicas nem ficam disponíveis apenas por conhecer o ID.

O arquivo privado de um participante não vira anexo compartilhado ao referenciá-lo
num grupo. Leitura, processamento por worker e envio revalidam os direitos do
destino. O conteúdo de documentos e imagens é dado não confiável, nunca comando
ou consentimento. Retenção e exclusão alcançam conteúdo e derivados; referência
de tarefa não ressuscita um arquivo excluído ou revogado.

Provas: envio e recebimento de imagem, PDF e planilha reais; recuperação posterior
por ID após URL de origem expirar; processamento em background do mesmo conteúdo;
nomes repetidos; eventos duplicados; falha entre persistência e ACK; arquivo acima
do limite; download inválido; isolamento entre participantes, privado e grupo;
revogação antes da leitura e antes da entrega.

### Ação e conversa precisam concordar

Distinguir informação, planejamento, execução, confirmação, correção, parada e
desfazer. São significados da conversa, não menus ou palavras obrigatórias.
O modelo propõe significado; serviços validam e executam.

Ação solicitada pode executar sem pergunta redundante quando seus efeitos
completos forem reversíveis e qualificados. Primeiros candidatos: lembretes e
eventos pessoais sem convidados nem notificações a terceiros. Considerar também
calendários compartilhados, automações disparadas e o que o provedor garante.
Ausência de convidados não prova reversibilidade.

Consequências que precisam de decisão são apresentadas com destinatário,
conteúdo, data, fuso e detalhes materiais suficientes. A resposta se vincula à
proposta exata. Se já existe autorização suficiente para aquilo e a política
permite, não repetir a pergunta. Ações financeiras e novas capacidades não
entram por generalização desta regra.

“Sim, mas amanhã” revisa, não aprova a versão anterior. “Pode mandar?” do usuário
pode ser pergunta de capacidade. “Ela disse sim” em texto encaminhado não é
consentimento do dono. Emoji ou resposta ambígua não vira aprovação implícita.
Esclarecer dentro da conversa, sem introduzir comandos.

### Corrigir é uma parte normal do uso

Antes do efeito externo, correção invalida a versão antiga. Durante chamada já
enviada, parada é cooperativa: acompanhar resultado e dizer o que aconteceu.
Depois de concluído, desfazer é compensação real vinculada ao resultado e à
situação atual.

Compensação não sobrescreve alterações posteriores de outra pessoa. Se convite
ou email já saiu, explicar que não é possível recolher; correção externa é outra
ação. “Desfeito” não pode significar apenas fluxo local cancelado.

### Recursos nativos quando poupam esforço

Botões são atalhos opcionais para ações claras; cards ajudam a comparar algo
visual. Não são outra forma de autorização. Texto livre e controle nativo
resolvem a mesma pendência com os mesmos checks. Uma correção invalida ambos.
Um toque seguido de “pode mandar” não executa duas vezes. Não adicionar botões
depois de toda resposta nem exigir clique para continuar a conversa.

| Recurso Kapso documentado em 08/09/2026     | Uso proposto                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Até três botões de resposta                 | Duas escolhas concretas, confirmação ou cancelamento quando o toque for mais fácil.                                                             |
| CTA de URL                                  | Abrir conexão contextual ou artefato; OAuth continua na superfície segura do provedor.                                                          |
| Lista de opções                             | Escolher entre alternativas reais quando houver mais opções do que cabe numa pergunta curta.                                                    |
| Mensagem com cabeçalho de mídia e carrossel | Comparar opções visuais quando imagens ajudarem; não usar imagens decorativas como pré-requisito de confirmação.                                |
| WhatsApp Flows                              | Considerar apenas para coleta estruturada que seja mais simples que conversar; não criar onboarding obrigatório nem fingir que substitui OAuth. |

A [documentação de interações](https://docs.kapso.ai/docs/whatsapp/typescript-sdk/interactive)
inclui carrossel de mídia livre dentro da janela de atendimento de 24 horas,
distinto de template aprovado. O [nó de workflow](https://docs.kapso.ai/docs/flows/step-types/send-interactive-node)
não oferece esse carrossel; usar API/SDK de mensagens, sem criar outro workflow
de produto na Kapso. [Flows](https://docs.kapso.ai/docs/whatsapp/typescript-sdk/flows)
exigem habilitação na conta WhatsApp Business.

Capacidade documentada não prova habilitação/entrega no nosso número. Qualificar
as mensagens reais, callbacks, janela de envio e versão instalada. O conjunto
visual é o permitido pelo WhatsApp, não cards de HTML arbitrário. Botões de
resposta podem ser substituídos por texto equivalente; conexão externa continua
exigindo abrir seu link. Falta de suporte não deve degradar para JSON ou comandos.

### Presença sem ruído

Entregar diretamente respostas rápidas. Se houver espera perceptível, reconhecer
o trabalho já aceito com uma frase contextual. Atualizar quando houver mudança
útil, bloqueio ou conclusão. “E aí?” recebe estado atual quando solicitado.

Agrupar fragmentos em janela curta e limitada é hipótese a medir, não espera
fixa em toda mensagem. Interrupções não aguardam essa janela. Não adicionar
segundo modelo só para escrever frases de espera; medir primeiro o caminho real
e as capacidades de presença do canal.

Não dividir uma frase em várias notificações. Resposta curta para tarefa simples;
síntese com artefato acessível para análise longa. Silêncio é válido após
encerramento ou monitoramento sem novidade, nunca para esconder falha, dúvida
pendente ou lembrete prometido.

### Memória perceptível e controlável

Lembrar reduz perguntas: idioma, fuso confirmado, preferência declarada e contexto
recorrente relevante. Não guardar tudo automaticamente. Separar “amanhã prefiro
à tarde” de “prefiro reuniões à tarde”. A pessoa pode perguntar a origem,
corrigir e esquecer pela conversa.

Esquecer alcança derivados e impede reintrodução por resumo antigo. Informações
de terceiros continuam atribuídas à fonte. Preferência não concede acesso ou
permissão permanente para agir.

### Humanização é um critério de aceitação desde o primeiro incremento

O Companion deve transmitir atenção, proximidade e discernimento. A pessoa
pode conversar sem transformar cada mensagem em tarefa. Emoção, brincadeira,
silêncio, hesitação e mudança de ideia fazem parte da experiência principal.
Isso será avaliado em sequências de conversa, junto da execução real.

O tom parte do contexto atual e das preferências explícitas. Uma mesma pessoa
pode querer objetividade no trabalho, entusiasmo numa conquista e espaço num
dia difícil. Por decisão explícita do usuário, minúsculas são o padrão da fala
conversacional do Companion, seguindo a referência do Poke. Isso atualiza a
hipótese anterior de deixar a caixa inteiramente aberta. Gíria, emoji e tamanho
de bolha continuam escolhas contextuais. Não inferir intimidade só pelo tempo de uso.

Reconhecer o que aconteceu com especificidade e proporção. Diante de uma tarefa
frustrante já delegada, reduzir o trabalho concreto. Diante de “só queria
desabafar”, ouvir sem transformar a fala em plano de produtividade. Uma pergunta
curta é útil quando muda a ajuda; perguntar sempre “acolhimento ou solução?”
também vira ritual. Não diagnosticar estado emocional nem registrar inferências
como traços da pessoa.

Discordar com motivo concreto, preservando a decisão que pertence ao usuário.
Validar frustração não exige concordar com acusações sobre terceiros. Reconsiderar
quando a pessoa traz informação nova. Entusiasmo reconhece a conquista real;
não exagera elogio, inventa esforço passado ou se atribui mérito pela vitória.

Humor acompanha uma abertura e permanece dispensável. Se a brincadeira não
cair bem, ajustar na próxima resposta sem defender a piada. Ao reparar erro
próprio, assumir o desencontro, corrigir o efeito possível dentro da autorização
existente e mostrar o resultado. Se a reparação exigir outra decisão, apresentá-la;
desculpas repetidas, autodepreciação e justificativa técnica não substituem isso.
"Você não me ouviu" precisa mudar o comportamento seguinte.

Proximidade permite calor, curiosidade e conversa casual. Não requer alegar
vivências, sentimentos privados, saudade ou vínculo exclusivo. Retorno após dias
não merece cobrança. Uma lembrança útil pode poupar uma pergunta; puxar assunto
sensível sem motivo para demonstrar memória pode fazer a pessoa se sentir vigiada.
“Não traga isso de novo” precisa ser respeitado no alcance pedido.

Silêncio é uma escolha de resposta verificável: “valeu, era isso” pode encerrar
sem outra notificação; “e aí?” com pedido aberto exige retorno. Não simular
demora humana nem fragmentar artificialmente o texto. Presença aparece no momento
adequado e no compromisso cumprido, não em volume de mensagens.

O conjunto de avaliação de humanização inclui pelo menos três variações por
categoria: abertura, mudança de contexto e feedback explícito. Abrange frustração,
irritação com o assistente, discordância, humor, celebração, ansiedade cotidiana,
tristeza, vergonha, indecisão, sobrecarga, silêncio, retomada, preferências,
proatividade, interrupção, reparação de erro, incerteza, limites, ambiguidade e
mudança de assunto. Acrescentar conflito com terceiros, conversa casual e mudança
de necessidade entre desabafo e ação como cruzamentos, sem encerrar o catálogo
nessa lista. Exemplos ilustram escolhas, não são scripts de respostas.

Revisão humana registra o trecho e o motivo por dimensão: atenção ao contexto,
proporção emocional, utilidade, autonomia, adaptação após feedback, honestidade,
discrição e ritmo. Comparar respostas plausíveis com contexto igual; não medir
apenas simpatia isolada. Vazamento, efeito não autorizado, fato inventado e
intimidade manipulativa são falhas próprias; uma média de naturalidade não as
compensa. Modelo avaliador pode ajudar a triar, nunca conceder autoridade.

Na implementação, evoluir as instruções existentes de estilo e interação,
seu contexto real de memória/pendências e a entrega pelo canal. Não criar um
classificador emocional obrigatório ou outro agente para “humanizar” cada frase.
Medir os casos primeiro e localizar se a falha é contexto ausente, instrução,
capacidade de execução ou transporte. Revisar exemplos e instruções junto de
cada incremento; não deixar humanização para uma etapa cosmética final.

### Voz escrita: minúsculas com clareza

Decisão do usuário em 08/09/2026: a fala conversacional do Companion deve usar
minúsculas, tendo o Poke como referência. Esta seção prevalece sobre a caixa
editorial dos exemplos antigos. É um contrato de desenho; não declara mudança
já instalada nas instruções ou no transporte do bot.

Na consulta específica, o Poke descreveu caixa baixa, omissão frequente do ponto
final em bolhas curtas, pontuação interna nas explicações longas, abreviações
contextuais e poucas exclamações/emojis. Trata-se de sua autodescrição estilística,
não de regra linguística universal: um ponto final não prova frieza, assim como
uma exclamação não prova entusiasmo falso.

| Escolha              | Direção para o Companion                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Minúsculas           | Padrão da prosa dirigida à pessoa, inclusive início de frase e mensagem.                                                                                                                                     |
| Ponto final          | Preferir omitir no fim de uma bolha curta e autossuficiente; manter pontos entre frases quando organizam o raciocínio. Textos longos podem usar pontuação completa.                                          |
| Vírgulas e acentos   | Preservar legibilidade e sentido. Não omitir acentos ou fabricar erros para simular digitação humana.                                                                                                        |
| Interrogação         | Usar em perguntas reais, inclusive curiosidade pertinente em conversa casual; não terminar todo turno com uma oferta de serviço.                                                                             |
| Exclamação           | Usar com moderação quando a situação comporta entusiasmo; não impor frieza às conquistas.                                                                                                                    |
| Reticências          | Reservar a uma função expressiva clara, sem espalhar hesitação ou suspense artificial.                                                                                                                       |
| Abreviações          | “pra” e “tô” podem compor a voz; “vc”, “tb” e outras abreviações dependem de contexto e legibilidade. Não copiar todo tique de escrita da pessoa.                                                            |
| Emojis e risadas     | Opcionais, proporcionais e ligados ao momento. Não adicionar risada automática, vários emojis ou uma reação depois de toda frase.                                                                            |
| Quebras              | Separar ideias completas; várias frases do mesmo raciocínio podem ficar na mesma mensagem. Quebra visual não deve implicar outra notificação por padrão.                                                     |
| Extensão             | Resposta curta para assunto simples; aprofundar quando a pessoa precisa ou pede. Não impor número fixo de palavras ou bolhas.                                                                                |
| Conteúdo exato       | Preservar código, URLs, caminhos, identificadores, siglas e citações. Conservar grafia de nomes quando necessária para reconhecimento ou precisão. Não aplicar lowercase ao texto inteiro depois da geração. |
| Texto para terceiros | Email, documento e outros artefatos seguem o registro pedido e a capitalização apropriada; a frase que os apresenta pode continuar em minúsculas.                                                            |

A voz usa verbos concretos e conteúdo específico. Evitar abertura burocrática,
elogio genérico, desculpa institucional e anúncio de bastidores. Humor deve poder
cessar ao primeiro sinal de desencontro. Acolhimento admite calor sem frases
prontas de consolo; discordância mantém um motivo verificável; memória poupa
explicações sem exibir um inventário da vida da pessoa. Erro próprio pede
reconhecimento e reparação no alcance autorizado, não autodepreciação performática.

Exemplos autorais desta voz, sem correspondência com tarefas executadas:

- Resultado confirmado: “mudei pra quarta, às 11h” — somente depois de alteração comprovada.
- Ambiguidade: “o lembrete do forno ou o da ligação?”
- Discordância: “eu ficaria com a segunda opção. a primeira chega depois do prazo” — opções e prazos presentes no contexto.
- Acolhimento: “poxa, você estava esperando por esse encontro. pode me contar” — expectativa relatada pela pessoa.
- Explicação: “o resumo ajuda a retomar o assunto, mas não confirma que uma ação aconteceu. pra dizer que o convite foi enviado, preciso do resultado do envio”
- Precisão técnica: “a variável é `API_TOKEN`; esse nome precisa continuar exatamente assim”
- Artefato formal: “o email pode ficar assim:” seguido de “Prezada equipe, confirmo o recebimento.”

Avaliar prosa nova, resposta longa, código misturado, nomes, documento formal,
pergunta, conquista, conflito e correção de tom. Não converter automaticamente
tudo para minúsculas, remover pontuação em massa ou fabricar atraso de digitação.
As escolhas de escrita não mudam o conteúdo autorizado nem a prova de execução.

### Acompanhamento faz parte da promessa

“Te aviso” corresponde a acompanhamento durável com condição de conclusão,
canal, orçamento e regras de interrupção. Lembrete tem hora/fuso; monitor tem
mudança relevante, frequência e silêncio. Não iniciar observação indefinida
porque um assunto foi mencionado.

Consolidar mudanças do mesmo assunto. Não insistir numa sugestão ignorada nem
usar lembrete comercial como se fosse pedido do usuário. Pausar, cancelar e
mudar frequência funcionam pela conversa.

### Limites transparentes

Cota inicial e bônus por cadastro pertencem à mesma conta. Oferta curta, motivo
real e benefício configurado, sem número ou preço inventado. Cadastro retoma o
pedido uma vez; outro canal ou callback repetido não produz outro bônus.

Proposta: reservar orçamento antes de aceitar trabalho pago/recorrente e separar
controle de conta/cancelamento da cota de geração. Trabalho aceito não deve sumir
quando a cota acaba. Sem orçamento para nova execução de monitor, pausar de forma
explícita e avisar uma vez. Política e valores precisam ser definidos antes de
oferecer o recurso.

## Jornadas que materializam o alvo

Resultados abaixo pressupõem execução confirmada. Não são respostas prontas
independentes do estado.

| Jornada                 | Sequência ilustrativa                                                                                                                | Comportamento necessário                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Começar e corrigir      | “Me lembra em 20 minutos de tirar o bolo.” → “Te aviso em 20 minutos.” → “Melhor em 15.” → “Mudei pra 15 minutos a partir de agora.” | Alterar o mesmo lembrete; o antigo não dispara. Sem cadastro.                   |
| Conectar e continuar    | “Reserva amanhã, 10–10h15, só pra mim, no horário de Brasília.” → link → consentimento → “Reservei amanhã, das 10 às 10h15.”         | Provar usuário e concessão; continuar pedido original com acesso necessário.    |
| Refinar antes de enviar | convite proposto às 10 → “Às 11, na verdade.” → resumo atualizado → “Pode mandar.” → resultado                                       | Invalidar proposta das 10; enviar um único convite das 11.                      |
| Interromper             | busca de horário iniciada → “Esquece isso.” → “Parei a busca.”                                                                       | Impedir novas ações desse pedido, preservar trabalho não relacionado.           |
| Retomar após desvio     | análise em andamento → pergunta curta sobre outro assunto → resposta → “E aquela análise?” → estado ou resultado                     | Retomar sem começar análise idêntica.                                           |
| Esclarecer o mínimo     | dois lembretes → “Cancela aquele.” → “O do forno ou o da ligação?”                                                                   | Não cancelar antes de identificar alvo.                                         |
| Desfazer                | evento pessoal confirmado → “Tira aquela reserva.” → resultado                                                                       | Compensar recurso exato, verificando propriedade e alterações posteriores.      |
| Recuperar incerteza     | provedor aceita, resposta se perde → “Ainda estou conferindo se a reserva entrou.” → consulta → resultado                            | Não reenviar cegamente; uma conclusão.                                          |
| Lembrar e esquecer      | preferência declarada → uso futuro adequado → “Esquece essa preferência.”                                                            | Origem, aplicação delimitada e supressão inclusive em resumos.                  |
| Retomar após cadastro   | pedido bate na cota → link → cadastro → pedido retomado                                                                              | Reserva e bônus transacionais, sem conta duplicada ou novo grant de integração. |

## Construir sobre o que existe

O runtime já entrega partes reais da fundação. Evoluir uma jornada por vez, sem
outro loop de agente, scheduler, banco de autoridade ou framework de conversa.
Referências são pontos de integração, não declaração de cobertura completa.

| Dono atual                                                                                                            | Reuso                                                                 | Mudança necessária                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| agent/lib/private-channel.ts; server/accounts/index.ts                                                                | Entrada verificada e resolveVerifiedSender.                           | Remetente não vinculado recebe instrução de entrar com Google, sem criar conta; limites antes de trabalho caro.                  |
| agent/lib/channel-session.ts; agent/hooks/session-owner.ts                                                            | Propriedade, sourceMessageId, alias e handoff Eve; texto enfileirado. | Referente do pedido, correção/stop e uso deliberado de queue/steer/cancel.                                                       |
| agent/lib/channel-input.ts; agent/lib/approval-response.ts                                                            | Pendências públicas Eve, Session.respond, revalidação.                | Decisão natural ligada à proposta entregue e sua revisão, substituindo JSON e /responder.                                        |
| agent/instructions/content/execution-safety.md; agent/instructions/content/role/interactive.md                        | Instruções existentes.                                                | Remover cartão obrigatório e proibição de aprovação em prosa; corrigir identidade/canal herdados junto da capacidade executável. |
| agent/instructions/content/message-style.md                                                                           | Já define proximidade e brevidade.                                    | Fala vinculada ao estado real, silêncio e adaptação ao canal. Mais prompt sozinho não resolve.                                   |
| server/channels/transport.ts; server/messaging/store.ts; agent/lib/private-channel-events.ts                          | Outbox, sequência, leases e entrega de eventos.                       | Consolidar partes, drenar consentimento/erro prontamente e tratar envio incerto que bloqueia conversa.                           |
| server/google-workspace/challenge.ts; app/api/google-workspace/connect/route.ts; agent/lib/google-workspace/client.ts | Desafio vinculado a usuário e callback.                               | Jornada sem sessão web prévia, escopos necessários e retorno após negar/expirar/conceder.                                        |
| agent/lib/google-workspace/calendar.ts                                                                                | Criação com identidade determinística.                                | Alteração, remoção, compensação e qualificação do efeito pessoal reversível.                                                     |
| agent/memory/profile.ts; agent/memory/personal_info.ts; server/memory/documents.ts                                    | Perfil por escopo, recall e escrita versionada.                       | Origem, correções, expiração e esquecimento sem reintrodução.                                                                    |
| server/schedules/native-report.ts; server/schedules/native-report-render.ts                                           | Entrega com receipts e supressão de nothing_to_report.                | Atenção, status conversacional, retomada e orçamento; qualificar atraso de polling por minuto.                                   |
| Conta interna existente                                                                                               | Identidade única para uso e cadastro posterior.                       | Ledger, reservas, estado de cadastro e bônus único ainda não encontrados.                                                        |

Eve continua dono de sessões, espera e execução durável. Effect é dono de lógica,
I/O e validação da aplicação. Projeção nova guarda apenas fatos de produto e
referências do Eve, não duplica transcrição/replay. Consultar APIs instaladas e
migrar consumidores internos atomicamente, sem camada de compatibilidade.

### Contrato mínimo antes da alteração funcional

Definir no dono existente a relação entre mensagem verificada, pedido, revisão,
proposta apresentada, decisão e resultado. Reusar IDs e schemas; acrescentar só
o vínculo ausente. A decisão natural valida:

1. Remetente verificado e conversa autorizada.
2. Referente inequívoco da proposta apresentada.
3. Revisão e argumentos atuais; correção invalida anterior.
4. Direitos e validade presentes na execução.
5. Consumo único, sem resolver outra ação por replay.
6. Resultado e compensação ligados ao efeito verdadeiro.

Interpretação do modelo é candidato ligado à mensagem, não booleano que se
autoautoriza. Regex de “sim” não substitui contexto. Resumo de memória não
substitui mensagem autorizadora. Provar essa fronteira antes da ação automática.

## Ordem de execução

| Incremento                 | Entrega vertical                                                                                                     | Dependência                                                              | Demonstração de aceitação                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Contrato e avaliação    | Alinhar onboarding, conversa principal, controles opcionais, tom e casos adversários; registrar divergências atuais. | Pesquisa e revisão independente.                                         | Resultado observável por caso, exemplos sintéticos, sem alegação de implementação.                                                                   |
| 1. Confirmar e corrigir    | Pendência Eve → resumo humano → resposta natural → ação exata; stop/revisão invalida pedido antigo.                  | Contrato de referente, revisão e propriedade.                            | Nos dois canais, corrigir horário e confirmar produz uma ação atual. Dois pendentes + “sim” exigem esclarecer. Restart e replay preservam resultado. |
| 2. Pedir, fazer e desfazer | Lembrete e evento pessoal qualificado executam dentro do pedido e aceitam correção/undo.                             | 1; compensação existe antes de declarar ação automaticamente reversível. | Remetente novo sem cadastro cria/altera/cancela; destino confirma; edição concorrente impede undo cego.                                              |
| 3. Conectar no ponto certo | Link → prova segura → escopos necessários → retorno ao pedido.                                                       | 1 e controle do efeito a executar.                                       | Navegador sem cookie: negar, expirar, conceder; sem repetição, grant silencioso ou duplicação.                                                       |
| 4. Continuidade e memória  | Fragmentos, assunto paralelo, status, restart, memória corrigível e conclusão sem ruído.                             | 1 e referências/outbox existentes.                                       | Vários turnos com “e aí?”, “não esse”, “valeu”; nada perdido, executado indevidamente ou reaprendido após esquecer.                                  |
| 5. Uso, cadastro e atenção | Reservar uso, bônus único, retomar pedido e limitar trabalho programado.                                             | Identidade, política de cota; 3 para handoff.                            | Concorrência não ultrapassa reserva; retry não cobra/bonifica duas vezes; destino explícito para tarefas quando orçamento acaba.                     |
| 6. Voz, arquivos e rotina  | Mesma experiência com transcrição e formatos reais qualificados; silêncio e monitoramento útil.                      | 1–5, por perfil externo disponível.                                      | Áudio corrigido, arquivo real, lembrete após restart, monitor sem novidade quieto, duas contas isoladas.                                             |

2 e 3 podem avançar em paralelo depois do contrato de 1. Pesquisa de ritmo e
medição começa cedo. No máximo três workers em worktrees isoladas; revisão ocupa
slot. Root integra composição, configuração, lock e migrações. Não criar pacotes
apenas para ocupar agentes.

O primeiro incremento termina com conversa real pequena e completa, não só novo
prompt ou infraestrutura sem consumidor. Não prometer agenda editável, imagem
entendida, grupo ou voz ao vivo antes de qualificar o perfil.

## Como saber que chegamos lá

Uma pessoa nova inicia, delega, corrige e conclui sem coaching do desenvolvedor.
Depois retoma o assunto e entende o que ocorreu quando houve falha. O avaliador
observa a conversa e o destino real.

Separar provas determinísticas (propriedade, revisão, consentimento, idempotência,
cota, isolamento) da avaliação de conversa (atenção, profundidade, clareza,
perguntas desnecessárias, recuperação, ruído). Testar estado e receipts além do
texto. Igualdade com frase pronta não avalia naturalidade; juiz de modelo não
prova autorização.

Matriz mínima: remetente novo; fragmentos; erro de digitação; dois pedidos;
mudança de assunto; correção antes/depois do envio; resposta antiga ou citada de
terceiro; webhook duplicado; restart; revogação; link expirado/encaminhado; escopo
parcial; timeout após aceitação; edição externa antes do undo; esquecimento e
restore; cota concorrente e bônus repetido; clique antigo; clique seguido de
confirmação textual; equivalência da decisão por botão e texto.

Medir recebimento durável → primeiro retorno útil → efeito confirmado → entrega,
separando p50/p95 por canal/tarefa quando houver amostra suficiente. Medir também
perguntas evitáveis, duplicações, intervenção para obter status e turnos para
corrigir. Nenhum benchmark/SLO numérico está aprovado; dois segundos é hipótese
de experiência, não promessa derivada da fala do Poke.

Funções puras usam entradas sintéticas. Integrações usam componentes/provedores
reais com contas e destinos de teste próprios. Não enviar histórico privado como
dataset a terceiros. Serviço ausente bloqueia prova do perfil. Build, teste
local, entrega nativa e admissão são evidências distintas.

## Decisões pendentes na etapa consumidora

- Método/campos mínimos de cadastro; quantidade, renovação e significado de cota.
- Reserva para lembretes/monitores; operações de controle sempre acessíveis.
- Horários silenciosos, urgência e tolerância de atraso de lembrete.
- Reversibilidade por capacidade e calendário de destino.
- Memória automática, fontes e expiração por tipo de informação.
- Seleção de modelo somente se medição mostrar insuficiência do perfil atual.

Essas decisões não impedem o desenho. Evitar pedir ao usuário agora detalhes
que ainda podem ser simplificados pela implementação.
