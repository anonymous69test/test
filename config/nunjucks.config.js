const jmespath = require('jmespath');
const showdown = require('showdown');
const moment = require('moment');

function configure(env) {
  env.addFilter('query', (data, query) => {
    return jmespath.search(data, query);
  });

  // Usage:
  // original = [{firstName: "jeff", lastName: "jefferson"}]
  // {{ original | map({fullName: "join(' ', [firstName, lastName])"}) }}
  // output => [{fullName: "jeff jefferson"}]
  env.addFilter('map', (data, queryObject) => {
    const mapping = Object.keys(queryObject)
      .map(k => `${k}: ${queryObject[k]}`)
      .join(',');
    const query = `[].{${mapping}}`;
    try {
      return jmespath.search(data, query);
    } catch (err) {
      /* istanbul ignore next */
      throw new Error(`error applying 'map' filter with query "${query}": ${err.message}`);
    }
  });

  env.addFilter('currency', (n, precision) => {
    return parseFloat(n,10).toFixed(precision);
  });

  env.addFilter('markdown', (text) => {
    const converter = new showdown.Converter();
    return converter.makeHtml(text);
  });

  env.addFilter('plural', (n, singular, plural) => {
    if (n === 1) {
      return singular;
    }
    return plural;
  })

  env.addFilter('nicedate', (date) => {
    return moment(date).format('MMMM Do YYYY');
  });

  env.addFilter('relativetime', (date) => {
    return moment(date).fromNow();
  });

  env.addFilter('pastorfuture', (date, past, future) => {
    if (new Date() > date) {
      return past
    }
    return future
  });
}

module.exports = configure;
