"use client";

import { useState } from "react";

type QuestionType = "free_text" | "multi_select";

type ChoiceOption = {
  key: string;
  label: string;
  isCorrect: boolean;
};

type SimpleQuestionBuilderProps = {
  clientId: string;
  quizVersionId: string;
  quizVersionLabel: string;
  questionCount: number;
  action: (formData: FormData) => void | Promise<void>;
};

function createOption(index: number, label: string): ChoiceOption {
  return {
    key: `option-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    isCorrect: false,
  };
}

export default function SimpleQuestionBuilder({
  clientId,
  quizVersionId,
  quizVersionLabel,
  questionCount,
  action,
}: SimpleQuestionBuilderProps) {
  const [questionType, setQuestionType] = useState<QuestionType>("free_text");
  const [options, setOptions] = useState<ChoiceOption[]>([
    createOption(1, "answer 1"),
    createOption(2, "answer 2"),
    createOption(3, "answer 3"),
  ]);
  const normalizedQuestionCount = Number.isFinite(questionCount) ? Math.max(0, Math.floor(questionCount)) : 0;
  const questionPositionOptions = Array.from({ length: normalizedQuestionCount + 1 }, (_, index) => index + 1);

  function updateOptionLabel(optionKey: string, value: string) {
    setOptions((prev) =>
      prev.map((entry) => (entry.key === optionKey ? { ...entry, label: value } : entry))
    );
  }

  function toggleOptionCorrect(optionKey: string) {
    setOptions((prev) =>
      prev.map((entry) =>
        entry.key === optionKey ? { ...entry, isCorrect: !entry.isCorrect } : entry
      )
    );
  }

  function addOption() {
    setOptions((prev) => [...prev, createOption(prev.length + 1, "")]);
  }

  function removeOption(optionKey: string) {
    setOptions((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((entry) => entry.key !== optionKey);
    });
  }

  return (
    <form action={action} className="mt-3 space-y-4">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="quiz_version_id" value={quizVersionId} />
      <input type="hidden" name="points" value="1" />

      <p className="text-sm text-slate-700">
        Adding to <span className="font-semibold text-slate-900">{quizVersionLabel}</span> draft version.
      </p>

      <label className="block text-sm text-slate-700">
        Position
        <select
          name="position"
          defaultValue={String(questionPositionOptions.length)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
        >
          {questionPositionOptions.map((position) => (
            <option key={position} value={String(position)}>{`Question ${position}`}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-slate-700">
        Question type
        <select
          name="ui_question_type"
          value={questionType}
          onChange={(event) => setQuestionType(event.target.value as QuestionType)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
        >
          <option value="free_text">Free text</option>
          <option value="multi_select">Multi select</option>
        </select>
      </label>

      <label className="block text-sm text-slate-700">
        Question
        <textarea
          name="prompt"
          required
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
          placeholder="Here is my question"
        />
      </label>

      {questionType === "multi_select" ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">
            Options (check all correct answers)
          </p>
          <div className="space-y-2">
            {options.map((option, index) => (
              <div
                key={option.key}
                className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
              >
                <input
                  type="checkbox"
                  name="correct_option_positions"
                  value={String(index + 1)}
                  checked={option.isCorrect}
                  onChange={() => toggleOptionCorrect(option.key)}
                  className="mt-2 h-4 w-4 rounded border-slate-300 text-slate-900"
                />
                <input
                  name="option_label"
                  value={option.label}
                  onChange={(event) => updateOptionLabel(option.key, event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
                  placeholder={`answer ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeOption(option.key)}
                  disabled={options.length <= 2}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
                <span className="self-center text-xs font-semibold text-emerald-600">
                  {option.isCorrect ? "Correct" : ""}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addOption}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            + Add option
          </button>
        </div>
      ) : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Free text questions are reviewed and marked manually.
        </p>
      )}

      <button
        type="submit"
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Add question
      </button>
    </form>
  );
}
