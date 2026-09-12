import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownIcon,
  ArrowUpRightIcon,
  CheckIcon,
  FileTextIcon,
  MicIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@web/components/ui/button";
import {
  ConversationIcons,
  OnboardingTrigger,
} from "../../_components/onboarding";
import { cn } from "@web/components/class-names";
import {
  MarketingFrame,
  MarketingShell,
} from "../../_components/marketing-shell";
import { ChatPreview } from "./chat-preview";
import { SkyBackdrop } from "./sky-backdrop";
import { RotatingHeadline } from "./rotating-headline";
import { ConnectionCarousel } from "./connection-carousel";
import styles from "./marketing-landing.module.css";

const steps = [
  { icon: MicIcon, title: "Conte", body: "Texto, áudio, foto ou documento." },
  {
    icon: FileTextIcon,
    title: "Organize",
    body: "Ele conecta os pontos por você.",
  },
  {
    icon: SearchIcon,
    title: "Encontre",
    body: "Sua memória, quando precisar.",
  },
  {
    icon: SparklesIcon,
    title: "Resolva",
    body: "Do pedido ao trabalho feito.",
  },
] as const;

const questions = [
  {
    question: "O que posso pedir ao Zoen?",
    answer:
      "Tudo o que está ocupando espaço na sua cabeça. Guardar uma ideia, encontrar um documento, acompanhar uma entrega, organizar a semana ou combinar um encontro. Conte o que você precisa resolver.",
  },
  {
    question: "Preciso aprender comandos?",
    answer:
      "Escreva como você fala. Mande um áudio no caminho, encaminhe uma mensagem ou compartilhe um documento. Seu Zoen entende o contexto e pergunta quando precisa de um detalhe seu.",
  },
  {
    question: "Ele lembra de uma conversa para outra?",
    answer:
      "Seu Zoen aprende com você. Preferências, pessoas, projetos e decisões se conectam para que você possa continuar de onde parou. Você pode perguntar o que ele lembra, corrigir ou pedir para esquecer.",
  },
  {
    question: "Como funciona com minha família e meus amigos?",
    answer:
      "Você escolhe suas pessoas de confiança. Com a participação delas, seu Zoen conversa com o Zoen de cada uma para combinar horários, organizar planos e acompanhar mudanças. Cada um cuida dos interesses da sua pessoa.",
  },
  {
    question: "O que ele compartilha em um grupo?",
    answer:
      "O necessário para o que vocês estão resolvendo, dentro do que você autorizou. Para combinar um jantar, ele pode compartilhar um horário livre sem contar o que ocupa o resto da sua agenda.",
  },
  {
    question: "Também funciona para o meu negócio?",
    answer:
      "Clientes, pedidos, prazos e documentos ganham contexto. Seu Zoen ajuda a acompanhar o trabalho com as ferramentas que você já usa, mesmo que hoje tudo aconteça em conversas e planilhas.",
  },
  {
    question: "E se a ferramenta que eu uso não estiver conectada?",
    answer:
      "Peça na conversa. Seu Zoen encontra uma conexão pronta ou constrói a integração em segundo plano. Você conecta sua conta e escolhe o que ele pode fazer. Ele cuida dos detalhes técnicos e avisa quando estiver funcionando.",
  },
  {
    question: "Eu continuo no controle?",
    answer:
      "Você define o objetivo e os limites. Pode corrigir, interromper ou mudar de ideia na conversa. Quando uma decisão precisa de você, o Zoen mostra o que está em jogo e pede sua escolha.",
  },
  {
    question: "Como começo?",
    answer:
      "Toque em Começar, abra a conversa e faça seu primeiro pedido. Seu Zoen segue com você por ali. Se preferir Telegram, é só escolher essa opção.",
  },
] as const;

export function MarketingLanding() {
  return (
    <MarketingShell active="product">
      <main className={styles.landing} id="conteudo">
        <SkyBackdrop />
        <section className={styles.hero} data-sky="0">
          <MarketingFrame className={styles.heroContent}>
            <p className="type-supporting-body">
              Seu dia, seu trabalho, suas pessoas. Um Zoen.
            </p>
            <h1 className={cn("type-signal", styles.heroTitle)}>
              Você não precisa
              <br />
              <RotatingHeadline />
            </h1>
            <div className={styles.integrations}>
              <span>Converse no</span>
              <ConversationIcons />
            </div>
            <div className={styles.actions}>
              <OnboardingTrigger className={styles.primaryButton} size="lg">
                Começar agora <ArrowUpRightIcon aria-hidden="true" />
              </OnboardingTrigger>
            </div>
          </MarketingFrame>
          <a
            aria-label="Ver como o Zoen ajuda no dia a dia"
            className={styles.scrollHint}
            href="#dia-a-dia"
          >
            <ArrowDownIcon aria-hidden="true" />
          </a>
        </section>

        <section className={styles.story} data-sky="1" id="dia-a-dia">
          <MarketingFrame className={styles.storyRow}>
            <h2 className={cn("type-signal", styles.largeTitle)}>
              Aquela ideia.
              <br />
              Aquele prazo.
              <br />
              Onde você
              <br />
              <em>salvou mesmo?</em>
            </h2>
            <Image
              alt="Lembretes espalhados entre mensagens, notas e abas"
              className={styles.storyImage}
              height={2624}
              sizes="(max-width: 760px) 90vw, 48vw"
              src="/marketing/scattered-notes.avif"
              unoptimized
              width={2192}
            />
          </MarketingFrame>
          <MarketingFrame className={cn(styles.storyRow, styles.reverse)}>
            <Image
              alt="Um calendário cheio de compromissos e lembretes"
              className={styles.storyImage}
              height={2628}
              sizes="(max-width: 760px) 90vw, 48vw"
              src="/marketing/calendar.avif"
              unoptimized
              width={2528}
            />
            <h2 className={cn("type-signal", styles.largeTitle)}>
              Você organiza
              <br />o calendário.
              <br />
              <em>
                A vida continua
                <br />
                acontecendo.
              </em>
            </h2>
          </MarketingFrame>
          <MarketingFrame className={styles.statement}>
            <h2 className={cn("type-signal", styles.largeTitle)}>
              O trabalho, a família,
              <br />
              as coisas só suas.
              <br />
              <em>É muita coisa para uma cabeça.</em>
            </h2>
            <p className="type-body">
              Você merece tempo para pensar no que vem depois.
            </p>
          </MarketingFrame>
        </section>

        <section className={styles.sky} data-sky="2">
          <MarketingFrame className={styles.skyContent}>
            <p className={styles.eyebrow}>MAIS ESPAÇO PARA</p>
            <h2 className={cn("type-signal", styles.lifeTitle)}>Sua vida.</h2>
            <Image
              alt=""
              className={styles.face}
              height={88}
              sizes="(max-width: 760px) 60vw, 360px"
              src="/marketing/companion-face.webp"
              unoptimized
              width={88}
            />
            <h2 className={cn("type-signal", styles.largeTitle)}>
              Deixe os detalhes com ele.
              <br />
              <em>Fique com os momentos.</em>
            </h2>
            <div className={styles.benefits}>
              <p>
                <strong>Capture a ideia.</strong>
                <span>Seu Zoen lembra onde ela leva.</span>
              </p>
              <p>
                <strong>Encontre o próximo passo.</strong>
                <span>Ele acompanha até estar resolvido.</span>
              </p>
              <p>
                <strong>Esteja presente.</strong>
                <span>As pequenas pendências ficam com ele.</span>
              </p>
            </div>
          </MarketingFrame>
        </section>

        <section className={styles.how} data-sky="3" id="como-funciona">
          <MarketingFrame>
            <h2 className={cn("type-signal", styles.centeredTitle)}>
              Começa com uma conversa.
              <br />
              <em>Continua com algo resolvido.</em>
            </h2>
            <div className={styles.messageExample}>
              <span>Você</span>
              <p>“Guarda esse contrato e me avisa antes de vencer.”</p>
            </div>
            <div className={styles.steps}>
              {steps.map((step) => (
                <div key={step.title}>
                  <step.icon aria-hidden="true" />
                  <h3 className="type-section-title">{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
            <div className={styles.replyExample}>
              <span>Zoen</span>
              <p>
                Guardei. O contrato vence em 30 de novembro. Vou te lembrar com
                uma semana de antecedência.
              </p>
            </div>
          </MarketingFrame>
        </section>

        <section className={styles.conversation} data-sky="3" id="para-voce">
          <MarketingFrame>
            <h2 className={cn("type-signal", styles.centeredTitle)}>
              Do jeito que você fala.
              <br />
              <em>No lugar onde já conversa.</em>
            </h2>
            <ChatPreview />
            <div className={styles.ease}>
              {[
                "Escreva com suas palavras",
                "Continue de onde parou",
                "Peça para ajustar",
                "Converse pelo seu canal",
              ].map((item) => (
                <span key={item}>
                  <CheckIcon aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>
          </MarketingFrame>
        </section>

        <section className={styles.landscapes} data-sky="4">
          <MarketingFrame>
            <h2 className={cn("type-signal", styles.centeredTitle)}>
              Para o que você precisa fazer.
              <br />
              <em>E para o que você quer viver.</em>
            </h2>
            <div className={styles.landscapeGrid}>
              <a className={styles.landscape} href="#para-voce">
                <Image
                  alt="Ilha flutuante com um escritório"
                  height={1708}
                  sizes="(max-width: 760px) 90vw, 44vw"
                  src="/marketing/office.webp"
                  unoptimized
                  width={3252}
                />
                <span>
                  NO TRABALHO<strong>Resolva.</strong>
                </span>
              </a>
              <a className={styles.landscape} href="#pessoas-de-confianca">
                <Image
                  alt="Ilha flutuante com um parque"
                  height={1708}
                  sizes="(max-width: 760px) 90vw, 44vw"
                  src="/marketing/park.webp"
                  unoptimized
                  width={3252}
                />
                <span>
                  NA SUA VIDA<strong>Esteja presente.</strong>
                </span>
              </a>
            </div>
          </MarketingFrame>
        </section>

        <section
          className={styles.connections}
          data-sky="4"
          id="suas-ferramentas"
        >
          <MarketingFrame className={styles.connectionContent}>
            <p className={styles.eyebrow}>
              AS FERRAMENTAS SÃO SUAS. A CONEXÃO É COM ELE.
            </p>
            <h2 className={cn("type-signal", styles.centeredTitle)}>
              “Conecta isso para mim?”
              <br />
              <em>Deixe com seu Zoen.</em>
            </h2>
            <p>
              Sua agenda, seus arquivos, o sistema do seu negócio. Peça na
              conversa. Ele encontra a conexão ou constrói o que falta em
              segundo plano. Você continua o seu dia.
            </p>
            <ConnectionCarousel />
            <p className={styles.quiet}>
              Você escolhe o acesso. Ele cuida dos detalhes.
            </p>
          </MarketingFrame>
        </section>

        <section
          className={styles.trusted}
          data-sky="5"
          id="pessoas-de-confianca"
        >
          <MarketingFrame className={styles.trustedGrid}>
            <div>
              <p className={styles.eyebrow}>SUA REDE DE CONFIANÇA</p>
              <h2 className={cn("type-signal", styles.largeTitle)}>
                Seu Zoen.
                <br />O Zoen deles.
                <br />
                <em>Um plano juntos.</em>
              </h2>
              <p>
                Um jantar com a família. A viagem dos amigos. A reunião que
                nunca encontra horário. Seu Zoen conversa com o Zoen das pessoas
                que você escolheu e cuida da combinação.
              </p>
              <p className={styles.quiet}>
                Vocês compartilham o plano. Cada pessoa mantém sua privacidade.
              </p>
            </div>
            <figure className={styles.networkMockup}>
              <Image
                alt="Mockup de iMessage: seu Zoen e o da Ana combinam um jantar para sexta às 20h, com sua confirmação."
                height={1536}
                sizes="(max-width: 760px) 115vw, 520px"
                src="/marketing/zoen-imessage.webp"
                unoptimized
                width={1024}
              />
              <figcaption>
                Só com quem você escolheu para a sua rede.
              </figcaption>
            </figure>
          </MarketingFrame>
        </section>

        <section className={styles.plans} data-sky="5">
          <MarketingFrame className={styles.planContent}>
            <h2 className={cn("type-signal", styles.centeredTitle)}>
              Comece com um pedido.
            </h2>
            <p>Seu Zoen entra no ritmo com você.</p>
            <div className={styles.actions}>
              <OnboardingTrigger className={styles.primaryButton} size="lg">
                Começar agora <ArrowUpRightIcon aria-hidden="true" />
              </OnboardingTrigger>
            </div>
          </MarketingFrame>
        </section>

        <section className={styles.faq} data-sky="6" id="duvidas">
          <MarketingFrame className={styles.faqGrid}>
            <div className={styles.faqIntro}>
              <p className={styles.eyebrow}>ANTES DO PRIMEIRO OI</p>
              <h2 className={cn("type-signal", styles.largeTitle)}>
                Pode perguntar.
              </h2>
              <p>Veja como começar com seu Zoen.</p>
              <Button
                className={styles.glassButton}
                nativeButton={false}
                render={<Link href="/docs" />}
                variant="outline"
              >
                Ler o guia <ArrowUpRightIcon aria-hidden="true" />
              </Button>
            </div>
            <div>
              {questions.map((item) => (
                <details className={styles.question} key={item.question}>
                  <summary>
                    {item.question}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </MarketingFrame>
        </section>
      </main>
    </MarketingShell>
  );
}
