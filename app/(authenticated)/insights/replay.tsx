"use client";

import { useEffect, useRef, useState } from "react";
import { Option, Schema } from "effect";
import type { Replayer } from "@rrweb/replay";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@web/i18n/context";
import type { AppRouter } from "@web/trpc/router";
import type { inferRouterOutputs } from "@trpc/server";
import "@rrweb/replay/dist/style.css";

export function DiagnosticReplay({
  events,
}: {
  readonly events: inferRouterOutputs<AppRouter>["insights"]["session"]["events"];
}) {
  const root = useRef<HTMLDivElement>(null);
  const playback = useRef<Replayer | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const { t } = useI18n();
  const hasReplay = events.some(
    (event) => event.kind === "replay" && event.payload !== null
  );
  useEffect(() => {
    const batches = events.filter((event) => event.kind === "replay");
    if (!root.current || !batches.length) return undefined;
    let disposed = false;
    let destroy: (() => void) | undefined;
    const container = root.current;
    void Promise.all([import("@rrweb/replay"), import("@rrweb/packer")])
      .then(([{ Replayer }, { unpack }]) => {
        if (disposed) return undefined;
        const data = batches.flatMap((batch) => {
          if (!batch.payload) return [];
          const result = Schema.decodeUnknownOption(
            Schema.fromJsonString(
              Schema.Struct({
                events: Schema.Array(
                  Schema.Struct({
                    type: Schema.Number,
                    data: Schema.Json,
                    timestamp: Schema.Number,
                  })
                ),
              })
            )
          )(batch.payload);
          return Option.isSome(result) ? result.value.events : [];
        });
        // The replayer accepts runtime-validated events and renders inside its sandboxed iframe.
        if (data.length < 2) return undefined;
        const player = new Replayer(
          data.map((event) => JSON.stringify(event)),
          {
            root: container,
            unpackFn: unpack,
            skipInactive: true,
            showWarning: false,
            showDebug: false,
            mouseTail: false,
            UNSAFE_replayCanvas: false,
          }
        );
        const fit = () => {
          const width = Number(player.iframe.width);
          if (width > 0)
            player.wrapper.style.zoom = String(
              Math.min(1, container.clientWidth / width)
            );
        };
        const observer = new ResizeObserver(fit);
        observer.observe(container);
        player.on("resize", fit);
        player.on("finish", () => {
          setPlaying(false);
        });
        playback.current = player;
        destroy = () => {
          observer.disconnect();
          player.destroy();
          playback.current = null;
        };
        setFailed(false);
        setPlaying(true);
        player.play();
        fit();
        return undefined;
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      destroy?.();
      container.replaceChildren();
    };
  }, [events]);
  return hasReplay ? (
    <div>
      <p className="mb-3 type-caption">{t("Reprodução da experiência")}</p>
      <Button
        variant="ghost"
        onClick={() => {
          const player = playback.current;
          if (!player) return;
          if (playing) player.pause();
          else
            player.play(
              player.getCurrentTime() >= player.getMetaData().totalTime
                ? 0
                : player.getCurrentTime()
            );
          setPlaying(!playing);
        }}
      >
        {t(playing ? "Pausar" : "Continuar")}
      </Button>
      <div ref={root} className="max-h-[60vh] overflow-auto rounded-2xl" />
      {failed && (
        <p role="alert">{t("Não foi possível carregar os diagnósticos.")}</p>
      )}
    </div>
  ) : null;
}
