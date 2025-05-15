document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const urlInput = document.getElementById('urlInput');
    const validateBtn = document.getElementById('validateBtn');
    const exportBtn = document.getElementById('exportBtn');
    const errorMessage = document.getElementById('errorMessage');
    const resultsSection = document.getElementById('resultsSection');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultsTableContainer = document.getElementById('resultsTableContainer');
    const resultsBody = document.getElementById('resultsBody');
    const noResultsMessage = document.getElementById('noResultsMessage');

    // Store validation results
    let validationResults = [];

    // Event listeners
    validateBtn.addEventListener('click', validateURLs);
    exportBtn.addEventListener('click', exportAsCSV);

    // Validate email preview URLs and their resources
    async function validateURLs() {
        // Clear previous results and messages
        validationResults = [];
        errorMessage.textContent = '';
        resultsBody.innerHTML = '';
        exportBtn.disabled = true;

        // Get URLs from input
        const urls = urlInput.value.trim().split('\n').filter(url => url.trim() !== '');

        // Validate input
        if (urls.length === 0) {
            showError('Please enter at least one URL.');
            return;
        }

        if (urls.length > 10) {
            showError('Maximum 10 URLs allowed.');
            return;
        }

        // Validate URL format
        const invalidURLs = urls.filter(url => !isValidURL(url));
        if (invalidURLs.length > 0) {
            showError(`Invalid URL format: ${invalidURLs.join(', ')}`);
            return;
        }

        // Show loading indicator
        loadingIndicator.classList.remove('hidden');
        resultsTableContainer.classList.add('hidden');
        noResultsMessage.classList.add('hidden');

        try {
            // Process each URL
            for (const sourceUrl of urls) {
                try {
                    // Fetch the HTML content from the URL
                    const html = await fetchHTMLContent(sourceUrl);
                    
                    if (html) {
                        // Extract resources from the HTML
                        const resources = extractResources(html);
                        
                        // Validate each resource
                        await validateResources(sourceUrl, resources);
                    } else {
                        showError(`Failed to fetch content from: ${sourceUrl}`);
                    }
                } catch (error) {
                    console.error(`Error processing URL ${sourceUrl}:`, error);
                    // Continue with the next URL instead of stopping the entire process
                }
            }

            // Display results
            if (validationResults.length > 0) {
                displayResults();
                exportBtn.disabled = false;
            } else {
                noResultsMessage.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error during validation:', error);
            showError('An error occurred during validation. Please try again.');
        } finally {
            loadingIndicator.classList.add('hidden');
        }
    }

    // Fetch HTML content from a URL
    async function fetchHTMLContent(url) {
        try {
            // Try using a CORS proxy service to bypass CORS restrictions
            // For GitHub Pages deployment, we'll use a public CORS proxy
            // Note: For a production app, you should set up your own proxy or use a paid service
            const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            
            const response = await fetch(corsProxyUrl, { 
                method: 'GET',
                headers: {
                    'Accept': 'text/html'
                }
            });
            
            if (response.ok) {
                return await response.text();
            } else {
                console.error(`Failed to fetch ${url} through proxy: ${response.status} ${response.statusText}`);
                
                // Try direct fetch as fallback (will work for same-origin or CORS-enabled sites)
                try {
                    const directResponse = await fetch(url, { 
                        method: 'GET',
                        mode: 'cors',
                        headers: {
                            'Accept': 'text/html'
                        }
                    });
                    
                    if (directResponse.ok) {
                        return await directResponse.text();
                    } else {
                        return null;
                    }
                } catch (directError) {
                    console.error(`Direct fetch also failed for ${url}:`, directError);
                    return null;
                }
            }
        } catch (error) {
            console.error(`Error fetching ${url} through proxy:`, error);
            
            // If proxy fails, try with no-cors as a last resort
            // This will at least tell us if the resource exists, even if we can't read its content
            try {
                await fetch(url, { 
                    method: 'HEAD',
                    mode: 'no-cors'
                });
                
                // If we get here without error, the resource exists but is CORS-restricted
                // Return a placeholder message that will be handled in the UI
                return '<!-- CORS_RESTRICTED -->';
            } catch (noCorsError) {
                console.error(`No-cors fetch also failed for ${url}:`, noCorsError);
                return null;
            }
        }
    }

    // Show error message
    function showError(message) {
        errorMessage.textContent = message;
    }

    // Extract links and images from HTML content
    function extractResources(html) {
        // Check if content is CORS-restricted
        if (html === '<!-- CORS_RESTRICTED -->') {
            return [{
                url: 'CORS_RESTRICTED',
                type: 'error',
                corsRestricted: true
            }];
        }
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const links = Array.from(doc.querySelectorAll('a')).map(a => ({
            url: a.getAttribute('href'),
            type: 'link'
        }));
        
        const images = Array.from(doc.querySelectorAll('img')).map(img => ({
            url: img.getAttribute('src'),
            type: 'image'
        }));
        
        return [...links, ...images].filter(resource => resource.url);
    }

    // Validate resource URLs
    async function validateResources(sourceUrl, resources) {
        // Handle CORS-restricted case
        if (resources.length === 1 && resources[0].corsRestricted) {
            validationResults.push({
                sourceUrl,
                url: sourceUrl,
                type: 'URL',
                status: 'Unknown',
                reason: 'CORS restricted - cannot access content'
            });
            return;
        }

        // If no resources found
        if (resources.length === 0) {
            validationResults.push({
                sourceUrl,
                url: sourceUrl,
                type: 'URL',
                status: 'Empty',
                reason: 'No links or images found'
            });
            return;
        }

        for (const resource of resources) {
            try {
                // Resolve relative URLs
                const absoluteUrl = new URL(resource.url, sourceUrl).href;
                
                // Check if URL is valid
                if (!isValidURL(absoluteUrl)) {
                    validationResults.push({
                        sourceUrl,
                        url: resource.url,
                        type: resource.type,
                        status: 'Broken',
                        reason: 'Invalid URL format'
                    });
                    continue;
                }
                
                // Try to validate the resource using the proxy for cross-origin requests
                let status = 'Unknown';
                let reason = '';
                
                try {
                    // Use the same CORS proxy for resource validation
                    const corsProxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(absoluteUrl)}&method=HEAD`;
                    
                    const proxyResponse = await fetch(corsProxyUrl);
                    const proxyData = await proxyResponse.json();
                    
                    // Check the status from the proxy response
                    if (proxyResponse.ok && proxyData.status && proxyData.status.http_code >= 200 && proxyData.status.http_code < 400) {
                        status = 'Valid';
                    } else {
                        status = 'Broken';
                        reason = `Resource unavailable (HTTP ${proxyData.status ? proxyData.status.http_code : 'unknown'})`;
                    }
                } catch (proxyError) {
                    console.error(`Error checking resource with proxy: ${absoluteUrl}`, proxyError);
                    
                    // Fallback to direct fetch with no-cors
                    try {
                        await fetch(absoluteUrl, { 
                            method: 'HEAD',
                            mode: 'no-cors'
                        });
                        
                        // If we get here without error, the resource might exist
                        status = 'Likely Valid';
                        reason = 'CORS restrictions prevent full validation';
                    } catch (directError) {
                        status = 'Broken';
                        reason = 'Network error or resource unavailable';
                    }
                }
                
                validationResults.push({
                    sourceUrl,
                    url: absoluteUrl,
                    type: resource.type,
                    status,
                    reason
                });
            } catch (error) {
                console.error(`General error processing ${resource.url}:`, error);
                // Any other errors processing this resource
                validationResults.push({
                    sourceUrl,
                    url: resource.url,
                    type: resource.type,
                    status: 'Broken',
                    reason: 'Error processing resource'
                });
            }
            
            // Add a small delay to prevent overwhelming the network
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Check if URL has valid format
    function isValidURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // Display validation results in the table
    function displayResults() {
        resultsBody.innerHTML = '';
        
        validationResults.forEach(result => {
            const row = document.createElement('tr');
            
            // Source URL cell - make it clickable
            const sourceUrlCell = document.createElement('td');
            const sourceUrlLink = document.createElement('a');
            sourceUrlLink.href = result.sourceUrl;
            sourceUrlLink.textContent = result.sourceUrl;
            sourceUrlLink.target = '_blank';
            sourceUrlLink.rel = 'noopener noreferrer';
            sourceUrlCell.appendChild(sourceUrlLink);
            
            // Resource URL cell - make it clickable
            const urlCell = document.createElement('td');
            if (result.url && result.url !== 'CORS_RESTRICTED') {
                const urlLink = document.createElement('a');
                urlLink.href = result.url;
                urlLink.textContent = result.url;
                urlLink.target = '_blank';
                urlLink.rel = 'noopener noreferrer';
                urlCell.appendChild(urlLink);
            } else {
                urlCell.textContent = result.url || 'N/A';
            }
            
            // Type cell
            const typeCell = document.createElement('td');
            typeCell.textContent = result.type.charAt(0).toUpperCase() + result.type.slice(1);
            
            // Status cell with improved visual indicators
            const statusCell = document.createElement('td');
            const statusSpan = document.createElement('span');
            
            if (result.status === 'Valid') {
                statusSpan.classList.add('status-valid');
            } else if (result.status === 'Likely Valid') {
                statusSpan.classList.add('status-valid');
            } else if (result.status === 'Broken') {
                statusSpan.classList.add('status-broken');
            } else {
                // For Unknown or Empty status
                statusSpan.classList.add('status-unknown');
            }
            
            statusSpan.textContent = result.status;
            if (result.reason) {
                statusSpan.title = result.reason; // Add tooltip with reason
            }
            
            statusCell.appendChild(statusSpan);
            
            // Add cells to row
            row.appendChild(sourceUrlCell);
            row.appendChild(urlCell);
            row.appendChild(typeCell);
            row.appendChild(statusCell);
            
            resultsBody.appendChild(row);
        });
        
        // Add summary statistics
        const totalResources = validationResults.length;
        const validResources = validationResults.filter(r => r.status === 'Valid' || r.status === 'Likely Valid').length;
        const brokenResources = validationResults.filter(r => r.status === 'Broken').length;
        const unknownResources = validationResults.filter(r => r.status !== 'Valid' && r.status !== 'Likely Valid' && r.status !== 'Broken').length;
        
        // Add a summary row at the bottom of the table
        const summaryRow = document.createElement('tr');
        summaryRow.classList.add('summary-row');
        
        const summaryCell = document.createElement('td');
        summaryCell.colSpan = 4;
        summaryCell.innerHTML = `
            <div class="results-summary">
                <span class="summary-total">Total: ${totalResources}</span>
                <span class="summary-valid">Valid: ${validResources}</span>
                <span class="summary-broken">Broken: ${brokenResources}</span>
                <span class="summary-unknown">Unknown: ${unknownResources}</span>
            </div>
        `;
        
        summaryRow.appendChild(summaryCell);
        resultsBody.appendChild(summaryRow);
        
        resultsTableContainer.classList.remove('hidden');
    }

    // Export results as CSV
    function exportAsCSV() {
        if (validationResults.length === 0) {
            return;
        }
        
        // Create CSV content with more detailed information
        const csvHeader = 'Source URL,Resource URL,Type,Status,Reason\n';
        const csvContent = validationResults.map(result => {
            // Properly escape fields for CSV format
            const sourceUrl = `"${(result.sourceUrl || '').replace(/"/g, '""')}"`;
            const url = `"${(result.url || '').replace(/"/g, '""')}"`;
            const type = `"${(result.type || '').replace(/"/g, '""')}"`;
            const status = `"${(result.status || '').replace(/"/g, '""')}"`;
            const reason = `"${(result.reason || '').replace(/"/g, '""')}"`;
            
            return `${sourceUrl},${url},${type},${status},${reason}`;
        }).join('\n');
        
        const csvData = csvHeader + csvContent;
        
        // Create timestamp for the filename
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
        
        // Create download link
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.setAttribute('href', url);
        link.setAttribute('download', `resource_validation_${timestamp}.csv`);
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the URL object after download starts
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 100);
    }
});
