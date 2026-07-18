const fs = require('fs');
const path = require('path');

const COURSES = {
  none: { id: 'none', name: 'None', holes: [] },
  bossey: { id: 'bossey', name: 'Bossey', file: 'bossey.csv' },
  esery: { id: 'esery', name: 'Esery', file: 'esery.csv' },
  chamonix: { id: 'chamonix', name: 'Chamonix', file: 'chamonix.csv' },
};

function parseCourseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const [hole, par, averageScore, difference] = line.split(',').map((part) => part.trim());
    return {
      hole: Number(hole),
      par: Number(par),
      averageScore: Number(averageScore),
      difference: Number(difference),
    };
  }).filter((row) => Number.isInteger(row.hole) && Number.isFinite(row.par) && Number.isFinite(row.averageScore));
}

function normalizeCourseId(courseId) {
  return COURSES[courseId] ? courseId : 'none';
}

function getCourse(courseId) {
  const id = normalizeCourseId(courseId);
  const course = COURSES[id];
  if (!course.file) return course;

  const filePath = path.join(__dirname, 'data', 'courses', course.file);
  const holes = parseCourseCsv(fs.readFileSync(filePath, 'utf8'));
  return { id: course.id, name: course.name, holes };
}

function getCourseOptions() {
  return Object.values(COURSES).map(({ id, name }) => ({ id, name }));
}

module.exports = {
  getCourse,
  getCourseOptions,
  normalizeCourseId,
};
