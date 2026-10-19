/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { filterSemesters, normalizeSemester, parseScores, semesterLabel, type RawScoreData } from './parse';

// Shape of /chapi/api/course/score_v2 `data` as pkucli api.rs get_scores reads it.
const sample: RawScoreData = {
  score: {
    cjxx: [
      { kcmc: '高等数学（B）（一）', xf: '5', xqcj: '92', kclbmc: '专业必修', xnd: '24-25', xq: '1' },
      { kcmc: '大学英语', xf: '2', xqcj: 'A-', kclbmc: '公共必修', xnd: '24-25', xq: '1' },
      { kcmc: '体育', xf: '1', xqcj: '合格', kclbmc: '公共必修', xnd: '24-25', xq: '2' },
      { kcmc: '数据结构与算法', xf: '3.5', xqcj: '88', kclbmc: '专业必修', xnd: '24-25', xq: '2' },
      { kcmc: '', xf: '1', xqcj: '90', xnd: '24-25', xq: '2' },
      { kcmc: '暑期实践', xf: 2, xqcj: 'P', kclbmc: '', xnd: '24-25', xq: '3' },
    ],
    gpa: { gpa: '3.712', xxxf: '13.5' },
  },
  gpa: {
    data: [
      { gpa: '3.801', xndxq: '24-25-1' },
      { gpa: '3.650', xndxq: '24-25-2' },
    ],
  },
};

describe('parseScores', () => {
  const s = parseScores(sample);

  test('overall gpa and credits', () => {
    expect(s.overallGpa).toBe(3.712);
    expect(s.totalCredits).toBe(13.5);
  });

  test('semesters follow gpa.data, extra course semesters appended', () => {
    expect(s.semesters.map((x) => [x.id, x.gpa, x.credits, x.courses.length])).toEqual([
      ['24-25-1', 3.801, 7, 2],
      ['24-25-2', 3.65, 4.5, 2],
      ['24-25-3', null, 2, 1],
    ]);
  });

  test('course fields; nameless rows dropped', () => {
    expect(s.semesters[0].courses[1]).toEqual({ name: '大学英语', credits: 2, score: 'A-', category: '公共必修', semester: '24-25-1' });
    expect(s.semesters[2].courses[0].category).toBeNull();
    expect(s.semesters.flatMap((x) => x.courses).some((c) => !c.name)).toBe(false);
  });

  test('missing sections and N/A', () => {
    expect(parseScores({})).toEqual({ overallGpa: null, totalCredits: null, semesters: [] });
    const noGpa = parseScores({ score: { cjxx: sample.score!.cjxx, gpa: { gpa: 'N/A' } } });
    expect(noGpa.overallGpa).toBeNull();
    // print_scores: without gpa.data, semesters come from the courses in order
    expect(noGpa.semesters.map((x) => x.id)).toEqual(['24-25-1', '24-25-2', '24-25-3']);
    expect(noGpa.semesters.every((x) => x.gpa === null)).toBe(true);
  });
});

describe('semesters', () => {
  test('label (fmt_semester)', () => {
    expect(semesterLabel('25-26-1')).toBe('25-26学年度1学期');
    expect(semesterLabel('odd')).toBe('odd');
  });

  test('normalize filters', () => {
    expect(normalizeSemester('25-26-1')).toBe('25-26-1');
    expect(normalizeSemester('2025-2026-2')).toBe('25-26-2');
    expect(normalizeSemester('2025-2026学年第1学期')).toBe('25-26-1');
    expect(normalizeSemester('24-25')).toBe('24-25');
    expect(normalizeSemester('秋季')).toBe('秋季');
  });

  test('filter by contains', () => {
    const all = parseScores(sample).semesters;
    expect(filterSemesters(all, '24-25-2').map((x) => x.id)).toEqual(['24-25-2']);
    expect(filterSemesters(all, '2024-2025').length).toBe(3);
    expect(filterSemesters(all, undefined).length).toBe(3);
    expect(filterSemesters(all, '23-24').length).toBe(0);
  });
});
