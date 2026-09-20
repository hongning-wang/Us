import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const source=process.argv[2]==='--file'?readFileSync(process.argv[3],'utf8'):process.argv[2];
const script=`tell application "Google Chrome"
repeat with w in windows
repeat with t in tabs of w
if URL of t contains "https://www.instagram.com/" then
return execute t javascript ${JSON.stringify(source)}
end if
end repeat
end repeat
error "Instagram tab is not open"
end tell`;
process.stdout.write(execFileSync('osascript',['-e',script],{encoding:'utf8',maxBuffer:20*1024*1024}));
