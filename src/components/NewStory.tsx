import { useState } from "react";
import type { Concept, Settings, Story } from "../types";
import { createStory } from "../lib/storage";
import { ConceptGacha, initialGacha, type GachaState } from "./ConceptGacha";

/** 既存の物語を複製してやり直すときの、引き継ぎ内容。 */
export interface Seed {
  title: string;
  keywords: string[];
  note: string;
  concept: Concept;
}

export function NewStory(props: { settings: Settings; seed?: Seed; onCreate: (s: Story) => Promise<void> }) {
  const { settings, seed } = props;
  const [state, setState] = useState<GachaState>(() => initialGacha(seed?.keywords ?? [], seed?.note ?? "", seed?.concept));

  return (
    <div className="page">
      <header className="page-head">
        <h2>{seed ? "複製してやり直す" : "新しい物語"}</h2>
      </header>
      {seed && (
        <p className="notice">
          「{seed.title}」の企画を複製しました。キーワードを修正してガチャを引き直せます。気に入った案で登録すると新しい物語として保存され、元の物語は変更されません。
        </p>
      )}
      <ConceptGacha
        settings={settings}
        state={state}
        update={setState}
        confirmLabel="この内容で物語を作る →"
        onConfirm={(p) => void props.onCreate(createStory(p.concept, p.keywords, settings.author, p.note, p.lines))}
      />
    </div>
  );
}
