/* Category JSON validation + prerequisite ordering.
   Exposed as window.CategoryValidator. No dependencies. */
(function (global) {
  'use strict';

  const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

  /** Returns an array of human-readable error strings. Empty array = valid. */
  function validate(data) {
    const errors = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return ['The file must contain a single JSON object at the top level.'];
    }

    if (!isNonEmptyString(data.category)) errors.push('"category" is missing or must be a non-empty string.');
    if (typeof data.description !== 'string') errors.push('"description" is missing or must be a string.');

    if (!Array.isArray(data.concepts) || data.concepts.length === 0) {
      errors.push('"concepts" is missing or must be a non-empty array.');
      return errors;
    }

    const ids = new Set();

    data.concepts.forEach((c, i) => {
      const at = `concepts[${i}]`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        errors.push(`${at} must be an object.`);
        return;
      }
      if (!isNonEmptyString(c.id)) {
        errors.push(`${at}.id is missing or must be a non-empty string.`);
      } else if (ids.has(c.id)) {
        errors.push(`${at}.id "${c.id}" is used more than once — ids must be unique.`);
      } else {
        ids.add(c.id);
      }
      if (!isNonEmptyString(c.title)) errors.push(`${at}.title is missing or must be a non-empty string.`);
      if (!Array.isArray(c.prerequisites) || !c.prerequisites.every(isNonEmptyString)) {
        errors.push(`${at}.prerequisites must be an array of concept id strings (use [] for none).`);
      }
      if (!Array.isArray(c.questions) || c.questions.length === 0) {
        errors.push(`${at}.questions is missing or must be a non-empty array.`);
        return;
      }
      c.questions.forEach((q, j) => {
        const qa = `${at}.questions[${j}]`;
        if (!q || typeof q !== 'object' || Array.isArray(q)) {
          errors.push(`${qa} must be an object.`);
          return;
        }
        if (!isNonEmptyString(q.question)) errors.push(`${qa}.question is missing or must be a non-empty string.`);
        if (q.type !== undefined && q.type !== 'hotspot') errors.push(`${qa}.type must be omitted or "hotspot".`);
        if (q.loaded !== undefined && typeof q.loaded !== 'boolean') errors.push(`${qa}.loaded must be true or false if present.`);
        if (q.type === 'hotspot') {
          // Tap-the-picture question: needs image, target, hotspots (ids in the SVG). choices/answerIndex are ignored.
          if (!isNonEmptyString(q.image)) errors.push(`${qa}.image is required for a hotspot question.`);
          if (!isNonEmptyString(q.target)) errors.push(`${qa}.target (the id of the correct element) is required for a hotspot question.`);
          if (!Array.isArray(q.hotspots) || q.hotspots.length < 2 || !q.hotspots.every(isNonEmptyString)) errors.push(`${qa}.hotspots must list 2+ element ids the player can tap.`);
          else if (isNonEmptyString(q.target) && !q.hotspots.includes(q.target)) errors.push(`${qa}.hotspots must include the target "${q.target}".`);
        } else {
          if (!Array.isArray(q.choices) || q.choices.length < 3 || q.choices.length > 4 || !q.choices.every(isNonEmptyString)) {
            errors.push(`${qa}.choices must be an array of 3–4 non-empty strings.`);
          }
          const n = Array.isArray(q.choices) ? q.choices.length : 0;
          if (Array.isArray(q.answerIndex)) {
            // Multiple correct answers: only allowed on Loaded Questions.
            if (!q.loaded) errors.push(`${qa}.answerIndex can only be a list on a Loaded Question (set "loaded": true).`);
            if (!q.answerIndex.length || !q.answerIndex.every(Number.isInteger)) errors.push(`${qa}.answerIndex list must contain whole numbers.`);
            else if (n && q.answerIndex.some((i) => i < 0 || i >= n)) errors.push(`${qa}.answerIndex has an index out of range for ${n} choices.`);
            else if (new Set(q.answerIndex).size !== q.answerIndex.length) errors.push(`${qa}.answerIndex has a duplicate index.`);
            else if (n && q.answerIndex.length >= n) errors.push(`${qa}.answerIndex marks every choice correct — leave at least one wrong.`);
          } else if (!Number.isInteger(q.answerIndex)) {
            errors.push(`${qa}.answerIndex is missing or must be a whole number.`);
          } else if (n && (q.answerIndex < 0 || q.answerIndex >= n)) {
            errors.push(`${qa}.answerIndex (${q.answerIndex}) is out of range for ${n} choices (use 0–${n - 1}).`);
          }
        }
        if (typeof q.explanation !== 'string') errors.push(`${qa}.explanation is missing or must be a string.`);
        // Optional visual: "image" (path/URL to an SVG or image) + "highlight" (id of an element inside that SVG).
        if (q.image !== undefined && !isNonEmptyString(q.image)) errors.push(`${qa}.image must be a non-empty string (path or URL) if present.`);
        if (q.highlight !== undefined && !isNonEmptyString(q.highlight)) errors.push(`${qa}.highlight must be a non-empty string (an element id in the SVG) if present.`);
        if (q.highlight !== undefined && q.image === undefined) errors.push(`${qa}.highlight needs an "image" to highlight.`);
        ['show', 'hide'].forEach((k) => { if (q[k] !== undefined && (!Array.isArray(q[k]) || !q[k].every(isNonEmptyString))) errors.push(`${qa}.${k} must be an array of element ids if present.`); });
      });
    });

    // Cross-reference prerequisites after all ids are known.
    data.concepts.forEach((c) => {
      if (!c || !Array.isArray(c.prerequisites)) return;
      c.prerequisites.forEach((p) => {
        if (!ids.has(p)) errors.push(`Concept "${c.id}" lists unknown prerequisite "${p}".`);
        if (p === c.id) errors.push(`Concept "${c.id}" lists itself as a prerequisite.`);
      });
    });

    if (errors.length === 0) {
      const cycle = findCycle(data.concepts);
      if (cycle) errors.push(`Prerequisites form a loop: ${cycle.join(' → ')}. Remove one link so concepts can be ordered.`);
    }

    return errors;
  }

  /** Stable topological sort (Kahn's algorithm). Ties keep file order. */
  function orderConcepts(concepts) {
    const byId = new Map(concepts.map((c) => [c.id, c]));
    const indegree = new Map(concepts.map((c) => [c.id, 0]));
    const dependents = new Map(concepts.map((c) => [c.id, []]));

    concepts.forEach((c) => {
      c.prerequisites.forEach((p) => {
        if (!byId.has(p)) return;
        indegree.set(c.id, indegree.get(c.id) + 1);
        dependents.get(p).push(c.id);
      });
    });

    const ready = concepts.filter((c) => indegree.get(c.id) === 0).map((c) => c.id);
    const out = [];
    const position = new Map(concepts.map((c, i) => [c.id, i]));

    while (ready.length) {
      ready.sort((a, b) => position.get(a) - position.get(b));
      const id = ready.shift();
      out.push(byId.get(id));
      dependents.get(id).forEach((d) => {
        indegree.set(d, indegree.get(d) - 1);
        if (indegree.get(d) === 0) ready.push(d);
      });
    }

    // If a cycle slipped through, append the rest in file order so nothing is lost.
    if (out.length < concepts.length) {
      const seen = new Set(out.map((c) => c.id));
      concepts.forEach((c) => { if (!seen.has(c.id)) out.push(c); });
    }
    return out;
  }

  function findCycle(concepts) {
    const graph = new Map(concepts.map((c) => [c.id, c.prerequisites || []]));
    const state = new Map(); // 1 = visiting, 2 = done
    const stack = [];
    let found = null;

    function visit(id) {
      if (found) return;
      const s = state.get(id);
      if (s === 2) return;
      if (s === 1) {
        found = stack.slice(stack.indexOf(id)).concat(id);
        return;
      }
      state.set(id, 1);
      stack.push(id);
      (graph.get(id) || []).forEach((p) => { if (graph.has(p)) visit(p); });
      stack.pop();
      state.set(id, 2);
    }

    concepts.forEach((c) => visit(c.id));
    return found;
  }

  global.CategoryValidator = { validate, orderConcepts };
})(typeof window !== 'undefined' ? window : globalThis);
