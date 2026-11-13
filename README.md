# Balloon Atlas

Interactive hot air balloon explorer (static site: no build step). Built for GitHub Pages and a Tableau web page extension.

- **Sky**: every balloon climbs with its age as the years play. Arrange by maker, size, region or shape; color by maker, status, size, era or shape. Click a balloon for its card.
- **Lineage**: maker -> naming series -> model tree over build years.
- Deep links: `#b=HAB-000004` opens a balloon, `#view=lineage` opens Lineage, `?year=2010` sets the start year.

## Refresh the data
```
python3 -I prep/build_data.py /path/to/hot_air_balloon.xlsx
```
This repairs overflow rows, parses fields and writes `data/balloons.json`. Retirement years are modeled (Weibull fit); see the in-app "About".

## Preview locally
`python3 -m http.server 8771` then open http://localhost:8771

## Tableau
Add a Web Page object pointing at the Pages URL. Tableau Cloud/Server must allow the domain (Settings -> Extensions -> safe list).
