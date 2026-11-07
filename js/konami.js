(function () {
'use strict';
const sequence = Object.freeze(['arrowup','arrowup','arrowdown','arrowdown','arrowleft','arrowright','arrowleft','arrowright','b','a']);
window.createKonamiMatcher = function (onMatch) {
  let index = 0;
  return function accept(key) {
    const value = String(key || '').toLowerCase();
    if (value === sequence[index]) index++;
    else index = value === sequence[0] ? 1 : 0;
    if (index !== sequence.length) return false;
    index = 0;
    if (typeof onMatch === 'function') onMatch();
    return true;
  };
};
window.KONAMI_SEQUENCE = sequence.slice();
})();
