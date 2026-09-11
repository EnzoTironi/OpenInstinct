# Primeira conversa, consentimento e continuidade

Contrato de produto atualizado em 08/09/2026. A conversa é o controle principal, inclusive para confirmar, corrigir, cancelar e desfazer. A decisão mais recente do usuário permite botões e cards quando facilitam a tarefa, sem tornar a conversa dependente deles. Este documento descreve o alvo; não declara comportamento implementado ou qualificado.

O desenho completo, pesquisa e plano estão em [Experiência de conversa](conversation-experience.md).

## Decisões confirmadas

- A primeira mensagem privada de um remetente verificado já inicia a experiência. Sem cadastro, login web, formulário ou escolha de modelo antes de ajudar. Conta interna e limites existem, mas não viram uma etapa de onboarding.
- Executar ações solicitadas quando seus efeitos completos forem reversíveis e a capacidade tiver execução, resultado e compensação qualificados. Um endpoint de exclusão não prova reversibilidade: retirar um evento não recolhe um convite.
- Quando a consequência exigir confirmação, apresentar o que vai acontecer em linguagem comum. A resposta natural resolve a ação exata. Botões opcionais podem oferecer a mesma decisão; ambos usam a mesma validação. Nunca mostrar JSON, código, nome de ferramenta ou comando especial. Não pedir de novo uma autorização já suficiente para a mesma ação.
- Pedir conexão somente quando necessária ao pedido atual. Um link contextual abre consentimento, solicita o acesso necessário e retoma o mesmo pedido. Não pedir repetição da tarefa ou cópia de código de volta ao chat.
- Ao esgotar a cota inicial, oferecer mais uso grátis por cadastro mínimo. Preservar conta, conversa, preferências e tarefa pendente. Conectar integração e completar cadastro são intenções distintas.
- Usar botão de conexão, opções curtas ou card útil quando pouparem esforço. Respostas por texto continuam válidas; uma correção invalida também botões da proposta antiga. Não simular uma interface arbitrária dentro do WhatsApp.
- Responder com contexto, atenção e profundidade proporcional. Poder ficar quieto quando a interação terminou. Não forçar gírias ou intimidade.

## Exemplos ilustrativos, não frases fixas

| Momento | Conversa desejada |
| --- | --- |
| Primeiro pedido | “Me lembra daqui a 20 minutos de tirar o bolo.” → “Te aviso daqui a 20 minutos.” |
| Correção | “Melhor em 15.” → “Mudei pra 15 minutos a partir de agora.” |
| Cancelar | “Pode cancelar esse lembrete.” → “Cancelei.” |
| Conectar | “Reserva amanhã das 10 às 10h15, só pra mim.” → “Conecta sua agenda aqui que eu já marco.” + link contextual |
| Retomar | Depois do consentimento: “Reservei amanhã, das 10 às 10h15.” Fuso explícito quando não estiver estabelecido. |
| Confirmar | “Vou convidar a Ana para a revisão amanhã, das 10 às 10h15, no horário de Brasília. Posso enviar?” → “Pode mandar.” → resultado real |
| Desfazer | “Tira aquela reserva.” → remover o evento exato, se ainda puder ser compensado; então informar o resultado |
| Cota | “Seu uso grátis acabou por agora. Um cadastro rápido libera mais uso grátis.” + link; cadastro concluído retoma o pedido |

O primeiro “oi” recebe uma saudação curta, sem catálogo ou tour. O primeiro pedido completo recebe trabalho. Não prometer lembrete antes de aceitação durável nem mudança de agenda antes de confirmar o efeito.

## Contrato da confirmação natural

O texto do usuário é evidência de intenção, não atalho de segurança. O modelo propõe uma interpretação; o serviço valida remetente, conversa, ação pendente, revisão dos argumentos, validade, direitos atuais e consumo único antes de responder à pendência pública do Eve. Texto citado, documento, email ou página não autoriza ações.

“Sim” com dois referentes plausíveis exige uma pergunta curta. “Sim, mas às 11” é revisão, não aprova a versão das 10. Uma nova proposta não herda consentimento antigo. Uma resposta a outro assunto não autoriza a última ação por mera recência. Referências de resposta nativas ajudam, mas não são obrigatórias.

Cancelar antes do envio impede envio. Depois do efeito, verificar compensação e explicar o limite. Desfazer usa o resultado real e verifica alterações posteriores. Não criar outra máquina de aprovação paralela ao Eve nem trocar comandos visíveis por uma lista rígida de palavras secretas.

## Decisões e provas pendentes

### Pesquisa conversacional com Poke, 8 de setembro de 2026

Em resposta ao pedido de diversidade, o Poke enviou às 18h48 dezesseis cenários fictícios e quatro conversas completas. A leitura foi feita no Messages. São exemplos produzidos pelo próprio assistente, não testes de produto nem documentação verificada de seu backend. Os links ilustrativos de conexão não foram abertos.

| Cenário solicitado | Comportamento descrito pelo Poke |
| --- | --- |
| Só uma saudação | Resposta curta; espera um pedido sem apresentar cadastro ou menu. |
| Conhecimento geral | Responde sem pedir integração. |
| Lembrete simples | Agenda no próprio assistente e notifica no mesmo chat. |
| Primeira consulta de agenda | Pede conexão contextual antes de ler compromissos. |
| Primeiro email | Pede a conexão necessária à busca solicitada. |
| OAuth negado | Explica a ausência de acesso e permite continuar outro assunto. |
| Link expirado | Oferece novo link para o mesmo objetivo. |
| Retorno após conectar | Retoma a busca sem pedir os termos novamente. |
| Entrada por recipe | Mantém o objetivo da receita e pede sua integração necessária. |
| Primeira foto | Descreve leitura do anexo diretamente na conversa. |
| PDF ou planilha | Descreve leitura sem exigir Drive para o arquivo já enviado. |
| Primeiro contato em grupo | Responde ao contexto do grupo sem importar dados privados. |
| Troca de canal | Distingue conta vinculada de canal ainda não associado. |
| Abrir a web | Descreve acesso por link originado na conversa. |
| Limite de uso | Comunica a limitação e opções; mecanismo de cota não comprovado. |
| Retorno dias depois | Atende a nova mensagem sem cobrar a conexão abandonada. |

As quatro conversas cobrem: cálculo seguido de consulta de agenda com conexão; busca de email, rascunho, correção e autorização para enviar; leitura de fatura com limite de capacidade para pagamento; retomada de contexto com dados ainda faltantes para agendar. Confirmações e resultados são fictícios. A conversa de email divide a proposta e a pergunta em mensagens separadas; isso não impõe essa fragmentação ao Companion.

O Poke identificou sua explicação sobre associação de canais por telefone, armazenamento de tokens e funcionamento das cotas como hipótese de engenharia. Mesmo suas demais afirmações, apresentadas como fatos do produto, continuam sendo autorrelato nesta pesquisa. Não adotamos associação automática por telefone. O exemplo de foto fala em contexto imediato; no Companion permanece a exigência do usuário de guardar anexos no workspace e recuperá-los por ID, com controle de audiência.

Cadastro Google-only ou também email; tamanho e renovação das cotas; reserva de uso para trabalho aceito; horários silenciosos; limites de latência e atraso de lembretes. Nenhum preço, volume gratuito ou fornecedor adicional foi aprovado.

A entrada nativa atual já provisiona conta interna. Conexão em navegador sem sessão prévia precisa ser concluída e testada. Aprovação natural, correção em andamento, undo completo, cota e bônus exigem implementação. Pesquisa e prévia não são evidência de execução real.

Aceitação: jornadas reais de Telegram e WhatsApp, duas identidades, reinício, replay, consentimento negado/expirado, confirmação obsoleta, efeito externo incerto e compensação concorrente. Resultados e destino observado precisam concordar com a conversa.
