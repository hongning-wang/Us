import {execFileSync} from 'node:child_process';
const id='cfpipmocacikhgoohcdfmihpmkcbcamm';
const script=`tell application "Google Chrome"
repeat with w in windows
repeat with t in tabs of w
if URL of t is "chrome://extensions/" then
return execute t javascript ${JSON.stringify(`chrome.developerPrivate.reload('${id}',{failQuietly:true},()=>{});'reload requested'`)}
end if
end repeat
end repeat
error "Open chrome://extensions first"
end tell`;
console.log(execFileSync('osascript',['-e',script],{encoding:'utf8'}));
