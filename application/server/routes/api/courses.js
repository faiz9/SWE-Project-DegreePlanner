const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const axios = require('axios');
const { parse: parseHTML } = require('node-html-parser');
const { decode: decodeHTMLEntities } = require('html-entities');
const { query } = require('../../config/database');
const { requireAuth } = require('../../middleware/auth');

const COURSE_TABLE_NAME = 'courses';

/*
router.get('/test', (req, res) => {
  db.query(`select COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_COLUMN_NAME, REFERENCED_TABLE_NAME
  from information_schema.KEY_COLUMN_USAGE
  where TABLE_NAME = 'courses';`).then(([results, fields]) => {
    console.log(results);
    return res.json(results);
  }).catch((err) => {
    console.log("Could not search courses!");
    console.log(err.stack)
    return res.json([]);
  });
});
*/

router.get('/', (req, res) => {
  const regexStart = '^((.)+,)*';
  const regexEnd = '(,(.)+)*$';
  const baseQuery = `SELECT * FROM ${COURSE_TABLE_NAME}`;
  const requirementQuery = ' WHERE subarea REGEXP ?';
  const newRequirement = ' OR subarea REGEXP ?';
  let query = baseQuery;
  let queryParams = [];
  if (req.query.requirement) {
    const requirementString = req.query.requirement;
    const requirements = requirementString.split('|');
    query += requirementQuery;
    queryParams.push(regexStart + requirements[0] + regexEnd);
    for (let i=1; i < requirements.length; i++) {
      query += newRequirement;
      queryParams.push(regexStart + requirements[i] + regexEnd);
    }
  }
  console.log(queryParams);
  db.query(query, queryParams).then(([results, fields]) => {
    for (const result of results) {
      result.description = result.description.replaceAll('\\n', '\n');
    }
    console.log(results);
    return res.json(results);
  }).catch((err) => {
    console.log("Could not search courses!");
    console.log(err.stack)
    return res.json([]);
  });
});

router.get('/search', (req, res) => {
  const searchQuery = req.query?.query
  /*
  if (!searchQuery) {
    return res.json();
  }*/
  console.log(searchQuery);
  const queryParams = searchQuery.replaceAll(/ |\-/g, '').replaceAll(/(.)/g, '$1 ').trim().split(' ');
  console.log(queryParams);
  //const queryParams = req.query.query.split(/ |\-/);
  let regexString = queryParams[0];
  for (let i = 1; i < queryParams.length; i++) {
    regexString += '\-?' + queryParams[i];
  }

  if (!regexString || regexString === '') {
    return res.json([]);
  }

  db.query(`SELECT * FROM ${COURSE_TABLE_NAME} WHERE courseID REGEXP ?`, [regexString]).then(([results, fields]) => {
    for (const result of results) {
      result.description = result.description.replaceAll('\\n', '\n');
    }
    console.log(results);
    return res.json(results);
  }).catch((err) => {
    console.log("Could not search courses!");
    console.log(err.stack)
    return res.json([]);
  });
});

// ^([a-zA-Z ]+\d+\w*) (.+) \(Units: (.+)\)$

// Scrape all courses from SFSU's website
// This might help for populating our database
// Additional info to scrape: attributes, prerequisites
router.get('/scrape', (req, res) => {
  axios.get('https://bulletin.sfsu.edu/courses').then((axiosRes) => {
    const root = parseHTML(axiosRes.data);
    const subjectAnchors = root.querySelectorAll('#atozindex li a');
    const promises = [];
    const attributeSet = new Set();
    for (const anchor of subjectAnchors) {
      const path = anchor.attributes.href
      promises.push(new Promise((resolve, reject) => {
        axios.get(`https://bulletin.sfsu.edu${path}`).then((axiosRes) => {
          const root = parseHTML(axiosRes.data);
          const courseDivs = root.querySelectorAll('.sc_sccoursedescs .courseblock');
          const courses = [];
          for (const div of courseDivs) {
            const courseTitleElement = div.querySelector('.courseblocktitle strong');
            const fullCourseTitle = decodeHTMLEntities(courseTitleElement?.innerHTML).trim();
            const results = fullCourseTitle?.match(/^([A-Z \u00A0]+)(\d+\w*)[ ]+(.+?) *\(Units?: (.+)\)$/i);
            if (results) {
              const subject = results[1].trim().replaceAll(/[\u00A0 ]+/gi, '-');
              const courseNumber = results[2].replaceAll(/[\u00A0 ]+/gi, '').trim();
              const courseID = subject + courseNumber;
              const title = results[3];
              const units = results[4];
              const courseInt = parseInt(courseNumber);
              const division = (courseInt < 300) ? 'Lower' : 'Upper';

              const courseDescriptionElement = div.querySelector('.courseblockdesc');
              let description = '';

              if (courseDescriptionElement) {
                for (const node of courseDescriptionElement.childNodes) {
                  if (node.nodeType == 3) {
                    description += node.innerText;
                  } else if (node.tagName == "A") {
                    description += node.innerText;
                  } else if (node.tagName == "BR") {
                    description += '\n';
                  }
                }
                description += '\n';
              }

              for (const node of div.childNodes) {
                if (node.nodeType == 3) {
                  description += node.innerText;
                } else if (node.tagName == "A") {
                  description += node.innerText;
                } else if (node.tagName == "BR") {
                  description += '\n';
                }
              }
              description = decodeHTMLEntities(description).trim();

              const attributesElements = div.querySelectorAll('ul li');
              const attributes = [];
              const areas = [];
              if (attributesElements) {
                for (const attributeElement of attributesElements) {
                  const attribute = decodeHTMLEntities(attributeElement.innerText);
                  attributes.push(attribute);
                  attributeSet.add(attribute);
                  const attributeSegments = attribute.split(':');
                  if (attributeSegments.length > 1) {
                    areas.push(attributeSegments[0]);
                  }
                }
              }

              if (areas.length === 0) {
                areas.push(subject);
              }

              courses.push({courseID, title, units, areas, division, description, attributes});
            } else {
              console.log(`No results ${fullCourseTitle}`);
            }
          }
          resolve(courses);
        })
      }));
    }
    Promise.all(promises).then((allCourses) => {
      let count = 0;
      const courseData = [];
      for (const subjectCourses of allCourses) {
        for (const course of subjectCourses) {
          count += 1;
          courseData.push(course);
        }
      }
      console.log(`${count} courses found!`);
      let numAttributes = 0;
      const attributeList = [];
      attributeSet.forEach((key) => {
        attributeList.push(key);
        numAttributes += 1;
      });
      console.log(`${numAttributes} attributes found!`);
      attributeList.sort();
      for (const attribute of attributeList) {
        console.log(attribute);
      }
      return res.json(courseData);
    })
  })
});

router.get('/plan', requireAuth, (req, res) => {
  db.query(`SELECT reqID, codeID, category, exact, \`group\` FROM requirement WHERE userID = ?`, [req.user]).then(([results, fields]) => {
    return res.json(results);
  }).catch((err) => {
    return res.json([]);
  });
});

router.post('/plan/update', requireAuth, (req, res) => {
  if (req.body.reqID && req.body.courseID) {
    db.query(`UPDATE requirement SET codeID = ? WHERE userID = ? AND reqID = ?`, [req.body.courseID, req.user, req.body.reqID]).then(([results, fields]) => {
      db.query(`SELECT reqID, codeID, category, exact, \`group\` FROM requirement WHERE userID = ?`, [req.user]).then(([results, fields]) => {
        return res.json(results);
      }).catch((err) => {
        return res.json([]);
      });
    }).catch((err) => {
      return res.json([]);
    });
  } else {
    return res.json([]);
  }
});

router.get('/:courseID', (req, res) => {
  const courseID = req.params.courseID;
  db.query(`SELECT * FROM ${COURSE_TABLE_NAME} WHERE courseID = ?`, [courseID]).then(([results, fields]) => {
    if (results.length == 1) {
      // temporary fix for newline character
      results[0].description = results[0].description.replaceAll('\\n', '\n');
      return res.json(results[0]);
    } else {
      return res.json([]);
    }
  }).catch((err) => {
    return res.json([]);
  });
});



module.exports = router;