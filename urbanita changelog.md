*Urbanìta changelog - the road towards a complete urbanite tool!*

0.1
*7th August 2026*
The idea of a city lookup tool appears in my mind, it's time to make use of that domain you bought too long ago.
With some effort and some AI-assisted vibe coding, the Wikidata lookup is up and running, with a small menu and a blog section.

0.2
*8th August 2026*
The randomizer becomes a "Surprise me" button. The funniest thing so far - endless exploration of world cities!

0.3
*10th August 2026*
The idea of providing news articles – ideally related to urbanism, design, architecture – lands on a easily accessible news API. Some articles are more adherent to the chosen criteria than others, but the whole concept was to being able to see if something is happening now — a starting point.

0.4
*17th August 2026*
The layout is adjusted for better clarity, with the data sections clearly separated.

0.5
*18th August 2026*
The biggest changes. A movie section appears (thank you Edo), with the same Wikidata workflow showing most popular movies filmed in or related to the city. The "city name in the film title" criteria is abandoned as it seldom works for most cities.


0.6
*26th August 2026*
"Born here" arrives: the people a city produced, from architecture, design, ecology and the social sciences. Same Wikidata workflow as the films, filtered by occupation so the section stays about the fields this site cares about — the first version ranked purely by fame and handed New York back Paris Hilton, so a short list of performer occupations is now subtracted out. Where someone worked in more than one of these fields, the one closest to the built environment wins: Jane Jacobs reads as an urban planner rather than a sociologist.
The desktop collage rearranges to make room. The news moves out of the left column and runs the full width underneath everything else — the rest of the page is what a city *is*, the news is only what happens to be true this week.
Both Wikidata sections now go through the site's own Worker, which runs the slow query where nobody is watching and keeps the answer for a week. Wikidata answers the same question in half a second or in forty, more or less at random — Berlin beat the browser's patience once in seven tries — and a section that gave up looked exactly like a city with nobody in it. Rewriting the query turned out to change nothing; moving it off the page load changed everything. Now only the first visitor to a city ever waits, and if the Worker isn't there the site just asks Wikidata itself, as it always did.


_Next up_:
- a random trivia about the City section (thanks Edo x2!)
- most associated word to the City on a web search (thanks Edo x3!!!)