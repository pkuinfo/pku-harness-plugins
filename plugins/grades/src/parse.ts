/**
 * Parsing for treehole `/chapi/api/course/score_v2` (pkucli crates/treehole/src/api.rs
 * `get_scores` + display.rs `print_scores`). `data` is
 * `{ score: { cjxx: CourseScore[], gpa: { gpa, xxxf } }, gpa: { data: [{ gpa, xndxq }] } }`:
 * - `cjxx[]`: kcmc 课程名称, xf 学分, xqcj 成绩, kclbmc 课程类别, xnd 学年度 "25-26", xq 学期 "1"|"2"|"3"
 * - `score.gpa`: overall gpa ("N/A" when missing) and xxxf 总学分
 * - `gpa.data[]`: per-semester gpa keyed by xndxq "25-26-1"
 * Values are normally strings; numbers are accepted too.
 */

type Val = string | number | null | undefined;

export type RawCourseScore = { kcmc?: Val; xf?: Val; xqcj?: Val; kclbmc?: Val; xnd?: Val; xq?: Val };
export type RawScoreData = {
  score?: { cjxx?: RawCourseScore[] | null; gpa?: { gpa?: Val; xxxf?: Val } | null } | null;
  gpa?: { data?: { gpa?: Val; xndxq?: Val }[] | null } | null;
};

export type Score = {
  name: string;
  credits: number | null;
  /** As the registrar wrote it: "92", "A-", "合格", "W"… */
  score: string;
  category: string | null;
  /** "25-26-1" */
  semester: string;
};

export type Semester = {
  /** "25-26-1" */
  id: string;
  /** "25-26学年度1学期" (display.rs fmt_semester) */
  label: string;
  /** Registrar's semester GPA; null when the server has none. */
  gpa: number | null;
  /** Sum of the listed courses' credits. */
  credits: number;
  courses: Score[];
};

export type Scores = {
  overallGpa: number | null;
  totalCredits: number | null;
  semesters: Semester[];
};

const str = (v: Val) => (v == null ? '' : String(v).trim());
const num = (v: Val) => {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** display.rs fmt_semester: "25-26-1" → "25-26学年度1学期". */
export function semesterLabel(id: string): string {
  const p = id.split('-');
  return p.length === 3 ? `${p[0]}-${p[1]}学年度${p[2]}学期` : id;
}

/**
 * A user's semester filter in the server's "25-26-1" shape. Accepts "25-26-1", "2025-2026-1",
 * "2025-2026学年第1学期", "25-26" (a whole year); otherwise the trimmed input as-is.
 */
export function normalizeSemester(input: string): string {
  const nums = input.match(/\d+/g);
  if (!nums || nums.length < 2) return input.trim();
  const yy = (s: string) => (s.length === 4 ? s.slice(2) : s);
  const year = `${yy(nums[0])}-${yy(nums[1])}`;
  return nums[2] ? `${year}-${nums[2]}` : year;
}

export function parseScores(data: RawScoreData): Scores {
  const courses: Score[] = (data.score?.cjxx ?? [])
    .filter((c): c is RawCourseScore => !!c && typeof c === 'object')
    .map((c) => ({
      name: str(c.kcmc),
      credits: num(c.xf),
      score: str(c.xqcj),
      category: str(c.kclbmc) || null,
      semester: `${str(c.xnd)}-${str(c.xq)}`,
    }))
    .filter((c) => c.name);
  const gpas = (data.gpa?.data ?? []).filter((g) => g && str(g.xndxq));

  // print_scores: semester order follows gpa.data; without it, first appearance in cjxx.
  const ids = gpas.length ? gpas.map((g) => str(g.xndxq)) : courses.map((c) => c.semester);
  // Courses whose semester has no GPA row still need a home.
  for (const c of courses) ids.push(c.semester);
  const order = [...new Set(ids)];

  const semesters = order.map((id): Semester => {
    const list = courses.filter((c) => c.semester === id);
    const credits = list.reduce((sum, c) => sum + (c.credits ?? 0), 0);
    return { id, label: semesterLabel(id), gpa: num(gpas.find((g) => str(g.xndxq) === id)?.gpa), credits: Math.round(credits * 10) / 10, courses: list };
  });

  return {
    overallGpa: num(data.score?.gpa?.gpa),
    totalCredits: num(data.score?.gpa?.xxxf),
    semesters: semesters.filter((s) => s.courses.length || s.gpa != null),
  };
}

/** print_scores filter: keep semesters whose id contains the (normalized) filter. */
export function filterSemesters(semesters: Semester[], filter: string | undefined): Semester[] {
  if (!filter?.trim()) return semesters;
  const f = normalizeSemester(filter);
  return semesters.filter((s) => s.id.includes(f));
}
